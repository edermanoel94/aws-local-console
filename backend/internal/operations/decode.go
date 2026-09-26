package operations

import (
	"archive/zip"
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"reflect"
	"sort"
	"strconv"
	"strings"
	"time"
)

var (
	timeType   = reflect.TypeFor[time.Time]()
	readerType = reflect.TypeFor[io.Reader]()
	bytesType  = reflect.TypeFor[[]byte]()
)

// InputError is a validation problem found while decoding the JSON input.
type InputError struct {
	Path    string
	Message string
}

func (e *InputError) Error() string {
	if e.Path == "" {
		return e.Message
	}
	return e.Path + ": " + e.Message
}

func inputErrorf(path, format string, args ...any) error {
	return &InputError{Path: path, Message: fmt.Sprintf(format, args...)}
}

// parseJSONObject parses raw JSON keeping numbers exact.
func parseJSONObject(raw []byte) (map[string]any, error) {
	if len(bytes.TrimSpace(raw)) == 0 || bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
		return map[string]any{}, nil
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	var value any
	if err := decoder.Decode(&value); err != nil {
		return nil, &InputError{Message: "input is not valid JSON: " + err.Error()}
	}
	object, ok := value.(map[string]any)
	if !ok {
		return nil, &InputError{Message: "input must be a JSON object"}
	}
	return object, nil
}

// normalizeJSON converts values produced by encoding/json without UseNumber
// (float64) and nested json.RawMessage into the shapes decodeValue expects.
func normalizeJSON(value any) (map[string]any, error) {
	raw, err := json.Marshal(value)
	if err != nil {
		return nil, &InputError{Message: "input is not serializable: " + err.Error()}
	}
	return parseJSONObject(raw)
}

// decodeInput builds a new *XInput from a JSON object.
func decodeInput(inputType reflect.Type, input map[string]any) (reflect.Value, error) {
	ptr := reflect.New(inputType)
	if err := decodeStruct("", input, ptr.Elem()); err != nil {
		return reflect.Value{}, err
	}
	return ptr, nil
}

func decodeStruct(path string, object map[string]any, target reflect.Value) error {
	structType := target.Type()
	keys := make([]string, 0, len(object))
	for key := range object {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		value := object[key]
		fieldPath := joinPath(path, key)
		field, ok := lookupField(structType, key)
		if !ok {
			// "<Field>Base64" carries binary content for []byte / io.Reader fields.
			if name, isBase64 := strings.CutSuffix(key, "Base64"); isBase64 {
				if binaryField, found := lookupField(structType, name); found && isBinary(binaryField.Type) {
					text, isString := value.(string)
					if !isString {
						return inputErrorf(fieldPath, "expected a base64 string")
					}
					data, err := base64.StdEncoding.DecodeString(text)
					if err != nil {
						return inputErrorf(fieldPath, "invalid base64: %v", err)
					}
					target.FieldByIndex(binaryField.Index).Set(binaryValue(binaryField.Type, data))
					continue
				}
			}
			return inputErrorf(fieldPath, "unknown field %q for %s (valid fields: %s)", key, structType.Name(), strings.Join(fieldNames(structType), ", "))
		}
		if value == nil {
			continue
		}
		decoded, err := decodeValue(joinPath(path, field.Name), value, field.Type)
		if err != nil {
			return err
		}
		target.FieldByIndex(field.Index).Set(decoded)
	}
	return nil
}

// lookupField finds an exported field by exact name, then case-insensitively
// (so camelCase input like {"bucket": "x"} also works).
func lookupField(structType reflect.Type, name string) (reflect.StructField, bool) {
	if field, ok := structType.FieldByName(name); ok && field.IsExported() {
		return field, true
	}
	for i := 0; i < structType.NumField(); i++ {
		field := structType.Field(i)
		if field.IsExported() && strings.EqualFold(field.Name, name) {
			return field, true
		}
	}
	return reflect.StructField{}, false
}

func fieldNames(structType reflect.Type) []string {
	names := []string{}
	for i := 0; i < structType.NumField(); i++ {
		if field := structType.Field(i); field.IsExported() {
			names = append(names, field.Name)
		}
	}
	return names
}

func isBinary(t reflect.Type) bool { return t == bytesType || t == readerType }

func binaryValue(t reflect.Type, data []byte) reflect.Value {
	if t == readerType {
		return reflect.ValueOf(io.Reader(bytes.NewReader(data)))
	}
	return reflect.ValueOf(data)
}

func joinPath(path, key string) string {
	if path == "" {
		return key
	}
	return path + "." + key
}

func decodeValue(path string, value any, t reflect.Type) (reflect.Value, error) {
	switch {
	case t == timeType:
		parsed, err := decodeTime(path, value)
		if err != nil {
			return reflect.Value{}, err
		}
		return reflect.ValueOf(parsed), nil
	case isBinary(t):
		data, err := decodeBinary(path, value)
		if err != nil {
			return reflect.Value{}, err
		}
		return binaryValue(t, data), nil
	}

	switch t.Kind() {
	case reflect.Pointer:
		elem, err := decodeValue(path, value, t.Elem())
		if err != nil {
			return reflect.Value{}, err
		}
		ptr := reflect.New(t.Elem())
		ptr.Elem().Set(elem)
		return ptr, nil
	case reflect.String:
		var text string
		switch v := value.(type) {
		case string:
			text = v
		case json.Number:
			text = v.String()
		case bool:
			text = strconv.FormatBool(v)
		default:
			// Some string fields (e.g. SQS Policy, Lambda environment) hold JSON documents:
			// accept an object/array and serialize it.
			raw, err := json.Marshal(v)
			if err != nil {
				return reflect.Value{}, inputErrorf(path, "expected a string")
			}
			text = string(raw)
		}
		return reflect.ValueOf(text).Convert(t), nil
	case reflect.Bool:
		switch v := value.(type) {
		case bool:
			return reflect.ValueOf(v).Convert(t), nil
		case string:
			parsed, err := strconv.ParseBool(v)
			if err == nil {
				return reflect.ValueOf(parsed).Convert(t), nil
			}
		}
		return reflect.Value{}, inputErrorf(path, "expected a boolean")
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64:
		number, err := toNumber(path, value)
		if err != nil {
			return reflect.Value{}, err
		}
		parsed, err := strconv.ParseInt(number.String(), 10, t.Bits())
		if err != nil {
			return reflect.Value{}, inputErrorf(path, "expected an integer that fits %s", t.Kind())
		}
		return reflect.ValueOf(parsed).Convert(t), nil
	case reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64:
		number, err := toNumber(path, value)
		if err != nil {
			return reflect.Value{}, err
		}
		parsed, err := strconv.ParseUint(number.String(), 10, t.Bits())
		if err != nil {
			return reflect.Value{}, inputErrorf(path, "expected a non-negative integer")
		}
		return reflect.ValueOf(parsed).Convert(t), nil
	case reflect.Float32, reflect.Float64:
		number, err := toNumber(path, value)
		if err != nil {
			return reflect.Value{}, err
		}
		parsed, err := strconv.ParseFloat(number.String(), t.Bits())
		if err != nil || math.IsInf(parsed, 0) {
			return reflect.Value{}, inputErrorf(path, "expected a number")
		}
		return reflect.ValueOf(parsed).Convert(t), nil
	case reflect.Struct:
		object, ok := value.(map[string]any)
		if !ok {
			return reflect.Value{}, inputErrorf(path, "expected an object (%s)", t.Name())
		}
		target := reflect.New(t).Elem()
		if err := decodeStruct(path, object, target); err != nil {
			return reflect.Value{}, err
		}
		return target, nil
	case reflect.Slice:
		items, ok := value.([]any)
		if !ok {
			// Be lenient with single values for list fields (e.g. "Events": "s3:ObjectCreated:*").
			items = []any{value}
		}
		slice := reflect.MakeSlice(t, 0, len(items))
		for i, item := range items {
			elem, err := decodeValue(fmt.Sprintf("%s[%d]", path, i), item, t.Elem())
			if err != nil {
				return reflect.Value{}, err
			}
			slice = reflect.Append(slice, elem)
		}
		return slice, nil
	case reflect.Map:
		object, ok := value.(map[string]any)
		if !ok {
			return reflect.Value{}, inputErrorf(path, "expected an object")
		}
		if t.Key().Kind() != reflect.String {
			return reflect.Value{}, inputErrorf(path, "unsupported map key type %s", t.Key())
		}
		result := reflect.MakeMapWithSize(t, len(object))
		for key, item := range object {
			elem, err := decodeValue(joinPath(path, key), item, t.Elem())
			if err != nil {
				return reflect.Value{}, err
			}
			result.SetMapIndex(reflect.ValueOf(key).Convert(t.Key()), elem)
		}
		return result, nil
	case reflect.Interface:
		return decodeUnion(path, value, t)
	}
	return reflect.Value{}, inputErrorf(path, "unsupported field type %s", t)
}

func decodeUnion(path string, value any, t reflect.Type) (reflect.Value, error) {
	members, ok := unions[t]
	if !ok {
		return reflect.Value{}, inputErrorf(path, "fields of type %s are not supported by the console", t)
	}
	object, ok := value.(map[string]any)
	if !ok || len(object) != 1 {
		return reflect.Value{}, inputErrorf(path, "expected an object with exactly one of: %s", strings.Join(sortedKeys(members), ", "))
	}
	for tag, item := range object {
		memberType, found := members[tag]
		if !found {
			return reflect.Value{}, inputErrorf(path, "unknown %s member %q (expected one of: %s)", t.Name(), tag, strings.Join(sortedKeys(members), ", "))
		}
		member := reflect.New(memberType.Elem())
		valueField := member.Elem().FieldByName("Value")
		decoded, err := decodeUnionValue(joinPath(path, tag), item, valueField.Type())
		if err != nil {
			return reflect.Value{}, err
		}
		valueField.Set(decoded)
		result := reflect.New(t).Elem()
		result.Set(member)
		return result, nil
	}
	return reflect.Value{}, inputErrorf(path, "empty union")
}

// decodeUnionValue decodes a union member value. Binary members follow the AWS
// wire format, where blobs are base64 strings (DynamoDB {"B": "aGVsbG8="}).
func decodeUnionValue(path string, value any, t reflect.Type) (reflect.Value, error) {
	decodeBlob := func(path string, item any) (reflect.Value, error) {
		text, ok := item.(string)
		if !ok {
			return reflect.Value{}, inputErrorf(path, "expected a base64 string")
		}
		data, err := base64.StdEncoding.DecodeString(text)
		if err != nil {
			return reflect.Value{}, inputErrorf(path, "invalid base64: %v", err)
		}
		return reflect.ValueOf(data), nil
	}
	switch {
	case t == bytesType:
		return decodeBlob(path, value)
	case t.Kind() == reflect.Slice && t.Elem() == bytesType:
		items, ok := value.([]any)
		if !ok {
			return reflect.Value{}, inputErrorf(path, "expected a list of base64 strings")
		}
		slice := reflect.MakeSlice(t, 0, len(items))
		for i, item := range items {
			blob, err := decodeBlob(fmt.Sprintf("%s[%d]", path, i), item)
			if err != nil {
				return reflect.Value{}, err
			}
			slice = reflect.Append(slice, blob)
		}
		return slice, nil
	}
	return decodeValue(path, value, t)
}

func sortedKeys[V any](m map[string]V) []string {
	keys := make([]string, 0, len(m))
	for key := range m {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

func toNumber(path string, value any) (json.Number, error) {
	switch v := value.(type) {
	case json.Number:
		return v, nil
	case string:
		if _, err := strconv.ParseFloat(strings.TrimSpace(v), 64); err == nil {
			return json.Number(strings.TrimSpace(v)), nil
		}
	}
	return "", inputErrorf(path, "expected a number")
}

func decodeTime(path string, value any) (time.Time, error) {
	switch v := value.(type) {
	case json.Number:
		seconds, err := v.Float64()
		if err != nil {
			return time.Time{}, inputErrorf(path, "invalid epoch timestamp")
		}
		whole, frac := math.Modf(seconds)
		return time.Unix(int64(whole), int64(frac*1e9)).UTC(), nil
	case string:
		for _, layout := range []string{time.RFC3339Nano, time.RFC3339, "2006-01-02T15:04:05", "2006-01-02"} {
			if parsed, err := time.Parse(layout, v); err == nil {
				return parsed, nil
			}
		}
	}
	return time.Time{}, inputErrorf(path, "expected an RFC 3339 timestamp or epoch seconds")
}

// decodeBinary accepts a UTF-8 string, {"base64": "..."} or {"zipFiles": {name: content}}.
func decodeBinary(path string, value any) ([]byte, error) {
	switch v := value.(type) {
	case string:
		return []byte(v), nil
	case map[string]any:
		if encoded, ok := v["base64"].(string); ok && len(v) == 1 {
			data, err := base64.StdEncoding.DecodeString(encoded)
			if err != nil {
				return nil, inputErrorf(path, "invalid base64: %v", err)
			}
			return data, nil
		}
		if files, ok := v["zipFiles"].(map[string]any); ok && len(v) == 1 {
			return buildZip(path, files)
		}
		// Any other JSON object is sent as its JSON text (e.g. Lambda Invoke Payload).
		return json.Marshal(v)
	case []any, json.Number, bool:
		return json.Marshal(v)
	}
	return nil, inputErrorf(path, "expected a string, {\"base64\": ...} or {\"zipFiles\": {...}}")
}

func buildZip(path string, files map[string]any) ([]byte, error) {
	if len(files) == 0 {
		return nil, inputErrorf(path, "zipFiles must contain at least one file")
	}
	var buffer bytes.Buffer
	writer := zip.NewWriter(&buffer)
	for _, name := range sortedKeys(files) {
		content, ok := files[name].(string)
		if !ok {
			return nil, inputErrorf(joinPath(path, "zipFiles."+name), "file content must be a string")
		}
		header := &zip.FileHeader{Name: name, Method: zip.Deflate, Modified: time.Now()}
		// Executable bit so runtimes like provided.al2 can run a "bootstrap" file.
		header.SetMode(0o755)
		fileWriter, err := writer.CreateHeader(header)
		if err != nil {
			return nil, err
		}
		if _, err := io.WriteString(fileWriter, content); err != nil {
			return nil, err
		}
	}
	if err := writer.Close(); err != nil {
		return nil, err
	}
	return buffer.Bytes(), nil
}
