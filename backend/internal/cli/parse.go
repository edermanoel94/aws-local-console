package cli

import (
	"errors"
	"strings"
	"unicode"
)

// tokenize splits a command line like a POSIX shell: whitespace separates
// words, single quotes are literal, double quotes allow \" and \\ escapes.
func tokenize(line string) ([]string, error) {
	tokens := []string{}
	var current strings.Builder
	inWord := false
	quote := rune(0)
	escaped := false
	for _, r := range line {
		switch {
		case escaped:
			current.WriteRune(r)
			escaped = false
		case quote == '\'':
			if r == '\'' {
				quote = 0
			} else {
				current.WriteRune(r)
			}
		case quote == '"':
			switch r {
			case '"':
				quote = 0
			case '\\':
				escaped = true
			default:
				current.WriteRune(r)
			}
		case r == '\'' || r == '"':
			quote = r
			inWord = true
		case r == '\\':
			escaped = true
			inWord = true
		case unicode.IsSpace(r):
			if inWord {
				tokens = append(tokens, current.String())
				current.Reset()
				inWord = false
			}
		default:
			current.WriteRune(r)
			inWord = true
		}
	}
	if quote != 0 {
		return nil, errors.New("unterminated quote")
	}
	if escaped {
		current.WriteRune('\\')
	}
	if inWord {
		tokens = append(tokens, current.String())
	}
	return tokens, nil
}

// kebab converts an SDK name to AWS CLI style: ListObjectsV2 -> list-objects-v2,
// GetSMSAttributes -> get-sms-attributes, QueueUrl -> queue-url.
func kebab(name string) string {
	runes := []rune(name)
	var out strings.Builder
	for i, r := range runes {
		if unicode.IsUpper(r) && i > 0 {
			previous := runes[i-1]
			nextIsLower := i+1 < len(runes) && unicode.IsLower(runes[i+1])
			if unicode.IsLower(previous) || unicode.IsDigit(previous) || (unicode.IsUpper(previous) && nextIsLower) {
				out.WriteByte('-')
			}
		}
		out.WriteRune(unicode.ToLower(r))
	}
	return out.String()
}

// flag is one parsed --name value pair.
type flag struct {
	name  string
	value string
	bare  bool // given without a value
}

// splitFlags separates positional arguments from --flags.
func splitFlags(args []string) (positional []string, flags []flag) {
	for i := 0; i < len(args); i++ {
		arg := args[i]
		if !strings.HasPrefix(arg, "--") || len(arg) == 2 {
			positional = append(positional, arg)
			continue
		}
		name := strings.TrimPrefix(arg, "--")
		if key, value, ok := strings.Cut(name, "="); ok {
			flags = append(flags, flag{name: key, value: value})
			continue
		}
		if i+1 < len(args) && !strings.HasPrefix(args[i+1], "--") {
			flags = append(flags, flag{name: name, value: args[i+1]})
			i++
			continue
		}
		flags = append(flags, flag{name: name, bare: true})
	}
	return positional, flags
}
