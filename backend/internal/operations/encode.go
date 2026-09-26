package operations

import (
	"encoding/base64"
	"io"
	"reflect"
	"time"
	"unicode/utf8"
)

const maxBodyBytes = 5 << 20 // cap for streamed bodies shown in the console

// encodeOutput converts an SDK output struct into JSON-friendly values.
// ResultMetadata and unexported fields are dropped, nil pointers and nil maps
// are omitted, nil slices become [], streams and blobs become text or
// {"base64": ...}, and union members become {"<Tag>": value}.
func encodeOutput(output reflect.Value) any {
	return encodeValue(output, 0)
}

func encodeValue(v reflect.Value, depth int) any {
	if depth > 64 || !v.IsValid() {
		return nil
	}
	if v.Type() == timeType {
		return formatTime(v.Interface().(time.Time))
	}
	if v.Type() == bytesType {
		if v.IsNil() {
			return nil
		}
		return encodeBytes(v.Bytes())
	}
	switch v.Kind() {
	case reflect.Pointer:
		if v.IsNil() {
			return nil
		}
		return encodeValue(v.Elem(), depth+1)
	case reflect.Interface:
		if v.IsNil() {
			return nil
		}
		if reader, ok := v.Interface().(io.Reader); ok && v.Type().Implements(readerType) {
			return encodeStream(reader)
		}
		concrete := v.Elem()
		if tag := unionTag(concrete.Type()); tag != "" {
			member := concrete
			if member.Kind() == reflect.Pointer {
				member = member.Elem()
			}
			return map[string]any{tag: encodeUnionValue(member.FieldByName("Value"), depth+1)}
		}
		return encodeValue(concrete, depth+1)
	case reflect.Struct:
		object := map[string]any{}
		t := v.Type()
		for i := 0; i < t.NumField(); i++ {
			field := t.Field(i)
			if !field.IsExported() || field.Name == "ResultMetadata" {
				continue
			}
			fieldValue := v.Field(i)
			if isOmitted(fieldValue) {
				continue
			}
			object[field.Name] = encodeValue(fieldValue, depth+1)
		}
		return object
	case reflect.Slice, reflect.Array:
		items := make([]any, 0, v.Len())
		for i := 0; i < v.Len(); i++ {
			items = append(items, encodeValue(v.Index(i), depth+1))
		}
		return items
	case reflect.Map:
		object := make(map[string]any, v.Len())
		iter := v.MapRange()
		for iter.Next() {
			object[iter.Key().String()] = encodeValue(iter.Value(), depth+1)
		}
		return object
	case reflect.String:
		return v.String()
	case reflect.Bool:
		return v.Bool()
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64:
		return v.Int()
	case reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64:
		return v.Uint()
	case reflect.Float32, reflect.Float64:
		return v.Float()
	}
	return nil
}

// encodeUnionValue mirrors decodeUnionValue: binary union members are base64
// strings, as on the AWS wire.
func encodeUnionValue(v reflect.Value, depth int) any {
	switch {
	case v.Type() == bytesType:
		return base64.StdEncoding.EncodeToString(v.Bytes())
	case v.Kind() == reflect.Slice && v.Type().Elem() == bytesType:
		items := make([]any, 0, v.Len())
		for i := 0; i < v.Len(); i++ {
			items = append(items, base64.StdEncoding.EncodeToString(v.Index(i).Bytes()))
		}
		return items
	}
	return encodeValue(v, depth)
}

// isOmitted drops absent members: nil pointers, maps and interfaces, and
// unset enums (named string types whose zero value means "not present").
func isOmitted(v reflect.Value) bool {
	switch v.Kind() {
	case reflect.Pointer, reflect.Interface, reflect.Map, reflect.Func, reflect.Chan:
		return v.IsNil()
	case reflect.String:
		return v.Type().PkgPath() != "" && v.Len() == 0
	case reflect.Slice:
		return v.Type() == bytesType && v.IsNil()
	}
	return false
}

func encodeStream(reader io.Reader) any {
	if closer, ok := reader.(io.Closer); ok {
		defer closer.Close()
	}
	data, err := io.ReadAll(io.LimitReader(reader, maxBodyBytes+1))
	if err != nil {
		return map[string]any{"error": "failed to read body: " + err.Error()}
	}
	if len(data) > maxBodyBytes {
		return map[string]any{"truncated": true, "base64": base64.StdEncoding.EncodeToString(data[:maxBodyBytes])}
	}
	return encodeBytes(data)
}

func encodeBytes(data []byte) any {
	if utf8.Valid(data) {
		return string(data)
	}
	return map[string]any{"base64": base64.StdEncoding.EncodeToString(data)}
}

func formatTime(t time.Time) string {
	return t.UTC().Format(time.RFC3339)
}
