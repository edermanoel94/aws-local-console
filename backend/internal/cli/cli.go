// Package cli emulates a subset of the AWS CLI on top of the operation engine,
// so every command is executed against Floci and audited with source "cli".
package cli

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"github.com/edermanoel94/aws-local-console/backend/internal/audit"
	"github.com/edermanoel94/aws-local-console/backend/internal/operations"
	"github.com/edermanoel94/aws-local-console/backend/internal/services"
)

// Exit codes, as documented for the AWS CLI.
const (
	ExitOK         = 0
	ExitParse      = 252 // command syntax or parameter validation error
	ExitServiceErr = 254 // the service returned an error
	ExitOther      = 255 // connection or internal error
)

// Result is the answer of POST /cli/execute.
type Result struct {
	Command  string `json:"command"`
	ExitCode int    `json:"exitCode"`
	Stdout   string `json:"stdout"`
	Stderr   string `json:"stderr"`
	LogID    string `json:"logId,omitempty"`
}

// Runner executes CLI command lines.
type Runner struct {
	engine   *operations.Engine
	registry *services.Registry
	region   string
}

// NewRunner returns a runner; region is the default when none is given.
func NewRunner(engine *operations.Engine, registry *services.Registry, defaultRegion string) *Runner {
	return &Runner{engine: engine, registry: registry, region: defaultRegion}
}

var serviceAliases = map[string]string{
	"s3api":           "s3",
	"eventbridge":     "events",
	"cloudwatch-logs": "logs",
}

// session carries the state of one command execution.
type session struct {
	runner *Runner
	ctx    context.Context
	region string
	result *Result
	stdout strings.Builder
	stderr strings.Builder
}

func (s *session) fail(code int, format string, args ...any) {
	s.result.ExitCode = code
	fmt.Fprintf(&s.stderr, format, args...)
	if !strings.HasSuffix(s.stderr.String(), "\n") {
		s.stderr.WriteString("\n")
	}
}

// Run executes one command line.
func (r *Runner) Run(ctx context.Context, command, region string) Result {
	command = strings.TrimSpace(command)
	result := Result{Command: command}
	s := &session{runner: r, ctx: ctx, region: region, result: &result}
	if s.region == "" {
		s.region = r.region
	}
	s.dispatch(command)
	result.Stdout = s.stdout.String()
	result.Stderr = s.stderr.String()
	return result
}

func (s *session) dispatch(command string) {
	tokens, err := tokenize(command)
	if err != nil {
		s.fail(ExitParse, "error: %v", err)
		return
	}
	if len(tokens) == 0 {
		return
	}
	if tokens[0] == "help" || (tokens[0] == "aws" && (len(tokens) == 1 || tokens[1] == "help")) {
		s.stdout.WriteString(s.help())
		return
	}
	if tokens[0] == "clear" {
		return
	}
	if tokens[0] != "aws" {
		s.fail(ExitParse, "%s: command not found. Only 'aws' commands are supported; type 'help' for the syntax.", tokens[0])
		return
	}

	positional, flags := splitFlags(tokens[1:])
	// Global options.
	remaining := flags[:0]
	for _, f := range flags {
		switch f.name {
		case "region":
			s.region = f.value
		case "output":
			if f.value != "json" {
				s.fail(ExitParse, "only --output json is supported")
				return
			}
		case "endpoint-url", "profile", "no-cli-pager", "debug", "no-verify-ssl", "no-paginate", "no-sign-request":
			// Accepted for compatibility; the console always talks to Floci.
		default:
			remaining = append(remaining, f)
		}
	}
	flags = remaining

	if len(positional) == 0 {
		s.fail(ExitParse, "usage: aws <service> <command> [--flag value ...]\nType 'help' for the syntax.")
		return
	}
	serviceName := positional[0]
	if alias, ok := serviceAliases[serviceName]; ok {
		serviceName = alias
	}
	if positional[0] == "s3" {
		s.runS3(positional[1:], flags)
		return
	}
	def, ok := s.runner.registry.Get(serviceName)
	if !ok {
		s.fail(ExitParse, "aws: error: service '%s' is not available. Available services: %s", positional[0], strings.Join(s.serviceNames(), ", "))
		return
	}
	if len(positional) < 2 || positional[1] == "help" {
		s.stdout.WriteString(s.serviceHelp(def.ID))
		return
	}
	s.runGeneric(def.ID, positional[1], positional[2:], flags)
}

func (s *session) serviceNames() []string {
	names := []string{}
	for _, def := range s.runner.registry.All() {
		names = append(names, def.ID)
	}
	return names
}

// findOperation maps a kebab-case command to an operation.
func (s *session) findOperation(service, command string) *operations.Operation {
	for _, op := range s.runner.engine.Catalog().Operations(service) {
		if kebab(op.Name) == command {
			return op
		}
	}
	return nil
}

func (s *session) runGeneric(service, command string, extra []string, flags []flag) {
	op := s.findOperation(service, command)
	if op == nil {
		s.fail(ExitParse, "aws: error: argument operation: invalid choice: '%s'\nRun 'aws %s help' to list the available operations.", command, service)
		return
	}
	if len(extra) > 0 && extra[0] == "help" {
		s.stdout.WriteString(s.operationHelp(op))
		return
	}
	if len(extra) > 0 {
		s.fail(ExitParse, "aws: error: unrecognized arguments: %s", strings.Join(extra, " "))
		return
	}
	input, err := buildInput(op, flags)
	if err != nil {
		s.fail(ExitParse, "aws: error: %v", err)
		return
	}
	response, ok := s.execute(service, op.Name, input)
	if !ok {
		return
	}
	s.printJSON(response.Response.Output)
}

// execute runs an operation and reports failures on stderr like the AWS CLI.
func (s *session) execute(service, operation string, input map[string]any) (operations.ExecuteResponse, bool) {
	response, err := s.runner.engine.Execute(s.ctx, operations.ExecuteRequest{
		Service: service, Operation: operation, Region: s.region, Input: input,
	}, audit.SourceCLI)
	if err != nil {
		s.fail(ExitParse, "aws: error: %v", err)
		return response, false
	}
	s.result.LogID = response.ID
	if response.Status == audit.StatusSuccess {
		return response, true
	}
	switch response.Error.Kind {
	case audit.KindAWS, audit.KindUnsupported:
		s.fail(ExitServiceErr, "\nAn error occurred (%s) when calling the %s operation: %s", response.Error.Code, operation, response.Error.Message)
	case audit.KindValidation:
		s.fail(ExitParse, "\nParameter validation failed:\n%s", response.Error.Message)
	case audit.KindNetwork:
		s.fail(ExitOther, "\nCould not connect to the endpoint URL: %s", response.Error.Message)
	default:
		s.fail(ExitOther, "\n%s: %s", response.Error.Code, response.Error.Message)
	}
	return response, false
}

func (s *session) printJSON(output any) {
	if object, ok := output.(map[string]any); ok && len(object) == 0 {
		return
	}
	if output == nil {
		return
	}
	data, err := json.MarshalIndent(output, "", "    ")
	if err != nil {
		s.fail(ExitOther, "failed to render output: %v", err)
		return
	}
	s.stdout.Write(data)
	s.stdout.WriteString("\n")
}

// buildInput maps --kebab-flags to PascalCase input members.
func buildInput(op *operations.Operation, flags []flag) (map[string]any, error) {
	fields := map[string]operations.InputField{}
	for _, field := range op.InputFields() {
		fields[kebab(field.Name)] = field
	}
	input := map[string]any{}
	for _, f := range flags {
		field, ok := fields[f.name]
		if !ok {
			// --no-<flag> sets a boolean member to false.
			if negated, isNegation := strings.CutPrefix(f.name, "no-"); isNegation && f.bare {
				if target, found := fields[negated]; found && target.Type == "boolean" {
					input[target.Name] = false
					continue
				}
			}
			return nil, fmt.Errorf("unknown option: --%s\nValid options for %s: %s", f.name, kebab(op.Name), strings.Join(flagNames(fields), " "))
		}
		if f.bare {
			if field.Type != "boolean" {
				return nil, fmt.Errorf("argument --%s: expected one argument", f.name)
			}
			input[field.Name] = true
			continue
		}
		input[field.Name] = parseValue(f.value, field)
	}
	return input, nil
}

func flagNames(fields map[string]operations.InputField) []string {
	names := []string{}
	for name := range fields {
		names = append(names, "--"+name)
	}
	sort.Strings(names)
	return names
}

// parseValue uses the value as JSON when it parses as JSON; structure and map
// members also accept the shorthand "Key=Value,Other=Value".
func parseValue(raw string, field operations.InputField) any {
	var parsed any
	if err := json.Unmarshal([]byte(raw), &parsed); err == nil {
		return parsed
	}
	isStructured := strings.HasPrefix(field.Type, "map<") || (!strings.Contains(field.Type, "<") && field.Type != "string" && field.Type != "blob" && field.Type != "timestamp" && field.Type[0] >= 'A' && field.Type[0] <= 'Z')
	if isStructured && strings.Contains(raw, "=") {
		object := map[string]any{}
		for _, pair := range strings.Split(raw, ",") {
			key, value, _ := strings.Cut(pair, "=")
			object[strings.TrimSpace(key)] = strings.TrimSpace(value)
		}
		return object
	}
	return raw
}

func (s *session) help() string {
	var b strings.Builder
	b.WriteString(`AWS Local Console CLI - commands run against Floci through the Go API.

Usage:
  aws s3 ls                          list buckets
  aws s3 ls s3://bucket[/prefix]     list objects (add --recursive for all keys)
  aws s3 mb s3://bucket              create a bucket
  aws s3 rb s3://bucket [--force]    delete a bucket (--force deletes its objects first)
  aws s3 rm s3://bucket/key          delete an object
  aws <service> <operation> [--flag value ...]
                                     run any SDK operation, e.g.
                                       aws sqs list-queues
                                       aws sqs create-queue --queue-name orders
                                       aws dynamodb list-tables
                                       aws lambda list-functions
                                       aws sns publish --topic-arn arn:... --message hello
  aws <service> help                 list the operations of a service
  aws <service> <operation> help     list the options of an operation

Options are the operation input members in kebab-case (--queue-name -> QueueName).
Values that parse as JSON are sent as JSON, e.g. --attributes '{"VisibilityTimeout":"30"}'.
Structures also accept the shorthand Key=Value,Other=Value.
Global options: --region <name>, --output json.

Services: `)
	b.WriteString(strings.Join(s.serviceNames(), ", "))
	b.WriteString(" (aliases: s3api -> s3, eventbridge -> events)\n")
	return b.String()
}

func (s *session) serviceHelp(service string) string {
	var b strings.Builder
	fmt.Fprintf(&b, "Available operations for aws %s:\n", service)
	for _, op := range s.runner.engine.Catalog().Operations(service) {
		fmt.Fprintf(&b, "  %s\n", kebab(op.Name))
	}
	return b.String()
}

func (s *session) operationHelp(op *operations.Operation) string {
	var b strings.Builder
	fmt.Fprintf(&b, "aws %s %s\n\nOptions:\n", op.Service, kebab(op.Name))
	for _, field := range op.InputFields() {
		required := ""
		if field.Required {
			required = " (required)"
		}
		fmt.Fprintf(&b, "  --%s <%s>%s\n", kebab(field.Name), field.Type, required)
	}
	return b.String()
}
