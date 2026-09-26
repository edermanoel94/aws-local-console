package operations

import (
	"reflect"
	"sort"
)

// InputField describes one top-level input member.
type InputField struct {
	Name     string   `json:"name"`
	Type     string   `json:"type"`
	Required bool     `json:"required"`
	Enum     []string `json:"enum,omitempty"`
}

// InputFields describes the top-level members of the operation input.
func (o *Operation) InputFields() []InputField {
	required := map[string]bool{}
	for _, name := range o.Required {
		required[name] = true
	}
	fields := []InputField{}
	for i := 0; i < o.inputType.NumField(); i++ {
		field := o.inputType.Field(i)
		if !field.IsExported() {
			continue
		}
		fields = append(fields, InputField{
			Name:     field.Name,
			Type:     typeName(field.Type, 0),
			Required: required[field.Name],
			Enum:     enumValues(field.Type),
		})
	}
	// Required members first, then alphabetical.
	sort.SliceStable(fields, func(i, j int) bool {
		if fields[i].Required != fields[j].Required {
			return fields[i].Required
		}
		return fields[i].Name < fields[j].Name
	})
	return fields
}

// typeName renders a Smithy-like type name: string, integer, long, boolean,
// double, timestamp, blob, list<T>, map<string,T> or the structure name.
func typeName(t reflect.Type, depth int) string {
	if depth > 8 {
		return "any"
	}
	switch {
	case t == timeType:
		return "timestamp"
	case isBinary(t):
		return "blob"
	}
	switch t.Kind() {
	case reflect.Pointer:
		return typeName(t.Elem(), depth+1)
	case reflect.String:
		return "string"
	case reflect.Bool:
		return "boolean"
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32:
		return "integer"
	case reflect.Int64, reflect.Uint64:
		return "long"
	case reflect.Float32, reflect.Float64:
		return "double"
	case reflect.Slice:
		return "list<" + typeName(t.Elem(), depth+1) + ">"
	case reflect.Map:
		return "map<string," + typeName(t.Elem(), depth+1) + ">"
	case reflect.Struct, reflect.Interface:
		return t.Name()
	}
	return t.String()
}

// enumValues returns the allowed values of SDK enum types (named string types
// with a Values() method), following pointers and list elements.
func enumValues(t reflect.Type) []string {
	for t.Kind() == reflect.Pointer || t.Kind() == reflect.Slice {
		if t == bytesType {
			return nil
		}
		t = t.Elem()
	}
	if t.Kind() != reflect.String || t.PkgPath() == "" {
		return nil
	}
	method := reflect.Zero(t).MethodByName("Values")
	if !method.IsValid() || method.Type().NumIn() != 0 || method.Type().NumOut() != 1 {
		return nil
	}
	values := method.Call(nil)[0]
	if values.Kind() != reflect.Slice {
		return nil
	}
	result := make([]string, 0, values.Len())
	for i := 0; i < values.Len(); i++ {
		result = append(result, values.Index(i).String())
	}
	return result
}
