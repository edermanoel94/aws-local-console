// Package operations is the generic operation engine: it discovers every SDK
// operation by reflection, decodes JSON input into the SDK input struct,
// executes the call against Floci while capturing the raw HTTP exchange,
// classifies errors and serializes the output.
package operations

import (
	"context"
	"errors"
	"reflect"
	"sort"
	"strings"
	"sync"

	"github.com/aws/smithy-go"
	"github.com/aws/smithy-go/middleware"

	"github.com/edermanoel94/aws-local-console/backend/internal/services"
)

var (
	contextType = reflect.TypeFor[context.Context]()
	errorType   = reflect.TypeFor[error]()
)

// Operation is one SDK operation discovered by reflection.
type Operation struct {
	Service  string
	Name     string
	Mutating bool
	// Required lists the top-level input fields the SDK validator requires.
	Required []string

	method    reflect.Method
	inputType reflect.Type // XInput struct type
	optionFn  reflect.Type // func(*Options)
}

// InputType returns the SDK input struct type.
func (o *Operation) InputType() reflect.Type { return o.inputType }

// Catalog holds the operations of every registered service.
type Catalog struct {
	services map[string]*serviceOperations
}

type serviceOperations struct {
	ordered []*Operation
	byName  map[string]*Operation
	byLower map[string]*Operation
}

// NewCatalog discovers operations of every service client in the registry.
func NewCatalog(registry *services.Registry, defaultRegion string) *Catalog {
	catalog := &Catalog{services: map[string]*serviceOperations{}}
	var wg sync.WaitGroup
	var mu sync.Mutex
	for _, def := range registry.All() {
		wg.Add(1)
		go func() {
			defer wg.Done()
			client := registry.Client(def, defaultRegion)
			ops := discover(def.ID, client)
			mu.Lock()
			catalog.services[def.ID] = ops
			mu.Unlock()
		}()
	}
	wg.Wait()
	return catalog
}

// Operations returns the operations of a service sorted by name.
func (c *Catalog) Operations(service string) []*Operation {
	if ops, ok := c.services[service]; ok {
		return ops.ordered
	}
	return nil
}

// Names returns the operation names of a service.
func (c *Catalog) Names(service string) []string {
	names := []string{}
	for _, op := range c.Operations(service) {
		names = append(names, op.Name)
	}
	return names
}

// Find returns an operation by exact name, falling back to a case-insensitive match.
func (c *Catalog) Find(service, name string) (*Operation, bool) {
	ops, ok := c.services[service]
	if !ok {
		return nil, false
	}
	if op, ok := ops.byName[name]; ok {
		return op, true
	}
	op, ok := ops.byLower[strings.ToLower(name)]
	return op, ok
}

// discover enumerates methods with the signature
// (context.Context, *XInput, ...func(*Options)) (*XOutput, error).
func discover(service string, client any) *serviceOperations {
	ops := &serviceOperations{byName: map[string]*Operation{}, byLower: map[string]*Operation{}}
	clientType := reflect.TypeOf(client)
	for i := 0; i < clientType.NumMethod(); i++ {
		method := clientType.Method(i)
		t := method.Type // includes the receiver as In(0)
		if t.NumIn() != 4 || !t.IsVariadic() || t.NumOut() != 2 {
			continue
		}
		if t.In(1) != contextType || t.Out(1) != errorType {
			continue
		}
		input, output, options := t.In(2), t.Out(0), t.In(3).Elem()
		if input.Kind() != reflect.Pointer || input.Elem().Kind() != reflect.Struct || input.Elem().Name() != method.Name+"Input" {
			continue
		}
		if output.Kind() != reflect.Pointer || output.Elem().Name() != method.Name+"Output" {
			continue
		}
		if options.Kind() != reflect.Func || options.NumIn() != 1 {
			continue
		}
		op := &Operation{
			Service:   service,
			Name:      method.Name,
			Mutating:  isMutating(method.Name),
			method:    method,
			inputType: input.Elem(),
			optionFn:  options,
		}
		op.Required = requiredFields(client, op)
		ops.ordered = append(ops.ordered, op)
		ops.byName[op.Name] = op
		ops.byLower[strings.ToLower(op.Name)] = op
	}
	sort.Slice(ops.ordered, func(i, j int) bool { return ops.ordered[i].Name < ops.ordered[j].Name })
	return ops
}

var readOnlyPrefixes = []string{
	"List", "Get", "Describe", "Head", "Receive", "Scan", "Query", "BatchGet", "Search",
	"Lookup", "Select", "Filter", "Test", "Validate", "Estimate", "Check", "Detect", "Preview",
}

// isMutating reports whether an operation changes state (CONTRACT: false for
// List*/Get*/Describe*/Head*/Scan/Query/Receive* and similar read operations).
func isMutating(name string) bool {
	for _, prefix := range readOnlyPrefixes {
		if strings.HasPrefix(name, prefix) {
			return false
		}
	}
	return true
}

var errStopBeforeSend = errors.New("stop before send")

// requiredFields asks the SDK itself which top-level members are required:
// the operation is invoked with an empty input and a middleware that aborts at
// the Serialize step, right after the Initialize-step input validator ran. The
// validator's InvalidParamsError lists the missing required members. No HTTP
// request is sent.
func requiredFields(client any, op *Operation) (required []string) {
	defer func() {
		if recover() != nil {
			required = nil
		}
	}()
	abort := func(stack *middleware.Stack) error {
		return stack.Serialize.Add(middleware.SerializeMiddlewareFunc("ConsoleStopBeforeSend",
			func(context.Context, middleware.SerializeInput, middleware.SerializeHandler) (middleware.SerializeOutput, middleware.Metadata, error) {
				return middleware.SerializeOutput{}, middleware.Metadata{}, errStopBeforeSend
			}), middleware.Before)
	}
	_, err := op.call(context.Background(), client, reflect.New(op.inputType), abort)
	var invalid smithy.InvalidParamsError
	if !errors.As(err, &invalid) {
		return nil
	}
	required = []string{}
	for _, paramErr := range invalid.Errs() {
		var param smithy.InvalidParamError
		if !errors.As(paramErr, &param) {
			continue
		}
		// Fields are reported with the input struct as context: "SendMessageInput.QueueUrl".
		field := strings.TrimPrefix(param.Field(), op.inputType.Name()+".")
		if !strings.Contains(field, ".") {
			required = append(required, field)
		}
	}
	sort.Strings(required)
	return required
}

// call invokes the SDK method with extra APIOptions.
func (o *Operation) call(ctx context.Context, client any, input reflect.Value, apiOptions ...func(*middleware.Stack) error) (reflect.Value, error) {
	optionFn := reflect.MakeFunc(o.optionFn, func(args []reflect.Value) []reflect.Value {
		field := args[0].Elem().FieldByName("APIOptions")
		for _, option := range apiOptions {
			field.Set(reflect.Append(field, reflect.ValueOf(option)))
		}
		return nil
	})
	options := reflect.MakeSlice(reflect.SliceOf(o.optionFn), 1, 1)
	options.Index(0).Set(optionFn)
	results := o.method.Func.CallSlice([]reflect.Value{reflect.ValueOf(client), reflect.ValueOf(ctx), input, options})
	if errValue := results[1]; !errValue.IsNil() {
		return reflect.Value{}, errValue.Interface().(error)
	}
	return results[0], nil
}
