package cli

import (
	"fmt"
	"strings"
	"time"
)

// runS3 implements the high-level "aws s3" commands.
func (s *session) runS3(args []string, flags []flag) {
	if len(args) == 0 || args[0] == "help" {
		s.stdout.WriteString("Available commands for aws s3: ls, mb, rb, rm\nUse 'aws s3api <operation>' for any other S3 operation.\n")
		return
	}
	options := map[string]bool{}
	for _, f := range flags {
		switch f.name {
		case "recursive", "force":
			options[f.name] = true
		default:
			s.fail(ExitParse, "aws: error: unknown option --%s for 'aws s3 %s'", f.name, args[0])
			return
		}
	}
	switch args[0] {
	case "ls":
		if len(args) == 1 {
			s.listBuckets()
			return
		}
		bucket, prefix, ok := s.parseS3URI(args[1])
		if !ok {
			return
		}
		s.listObjects(bucket, prefix, options["recursive"])
	case "mb":
		bucket, ok := s.bucketArg(args)
		if !ok {
			return
		}
		input := map[string]any{"Bucket": bucket}
		if s.region != "us-east-1" {
			input["CreateBucketConfiguration"] = map[string]any{"LocationConstraint": s.region}
		}
		if _, ok := s.execute("s3", "CreateBucket", input); !ok {
			s.prefixError("make_bucket failed: s3://" + bucket)
			return
		}
		fmt.Fprintf(&s.stdout, "make_bucket: %s\n", bucket)
	case "rb":
		bucket, ok := s.bucketArg(args)
		if !ok {
			return
		}
		if options["force"] && !s.deleteAllObjects(bucket) {
			return
		}
		if _, ok := s.execute("s3", "DeleteBucket", map[string]any{"Bucket": bucket}); !ok {
			s.prefixError("remove_bucket failed: s3://" + bucket)
			return
		}
		fmt.Fprintf(&s.stdout, "remove_bucket: %s\n", bucket)
	case "rm":
		if len(args) != 2 {
			s.fail(ExitParse, "usage: aws s3 rm s3://bucket/key")
			return
		}
		bucket, key, ok := s.parseS3URI(args[1])
		if !ok {
			return
		}
		if key == "" {
			s.fail(ExitParse, "aws: error: an object key is required: s3://bucket/key")
			return
		}
		if _, ok := s.execute("s3", "DeleteObject", map[string]any{"Bucket": bucket, "Key": key}); ok {
			fmt.Fprintf(&s.stdout, "delete: s3://%s/%s\n", bucket, key)
		}
	default:
		s.fail(ExitParse, "aws: error: 'aws s3 %s' is not supported by the console CLI. Supported: ls, mb, rb, rm. Use 'aws s3api ...' for other operations.", args[0])
	}
}

// prefixError puts the AWS CLI style prefix in front of the reported error.
func (s *session) prefixError(prefix string) {
	message := strings.TrimLeft(s.stderr.String(), "\n")
	s.stderr.Reset()
	s.stderr.WriteString(prefix + " " + message)
}

func (s *session) bucketArg(args []string) (string, bool) {
	if len(args) != 2 {
		s.fail(ExitParse, "usage: aws s3 %s s3://bucket", args[0])
		return "", false
	}
	bucket, key, ok := s.parseS3URI(args[1])
	if ok && key != "" {
		s.fail(ExitParse, "aws: error: expected a bucket, got an object path: %s", args[1])
		return "", false
	}
	return bucket, ok
}

func (s *session) parseS3URI(uri string) (bucket, key string, ok bool) {
	rest, found := strings.CutPrefix(uri, "s3://")
	if !found || rest == "" {
		s.fail(ExitParse, "aws: error: invalid S3 path %q, expected s3://bucket[/key]", uri)
		return "", "", false
	}
	bucket, key, _ = strings.Cut(rest, "/")
	return bucket, key, true
}

func (s *session) listBuckets() {
	response, ok := s.execute("s3", "ListBuckets", map[string]any{})
	if !ok {
		return
	}
	output, _ := response.Response.Output.(map[string]any)
	buckets, _ := output["Buckets"].([]any)
	for _, item := range buckets {
		bucket, _ := item.(map[string]any)
		name, _ := bucket["Name"].(string)
		created, _ := bucket["CreationDate"].(string)
		fmt.Fprintf(&s.stdout, "%s %s\n", cliTime(created), name)
	}
}

func (s *session) listObjects(bucket, prefix string, recursive bool) {
	input := map[string]any{"Bucket": bucket}
	if prefix != "" {
		input["Prefix"] = prefix
	}
	if !recursive {
		input["Delimiter"] = "/"
	}
	// Keys are shown relative to the "directory" of the prefix, like the AWS CLI.
	base := ""
	if index := strings.LastIndex(prefix, "/"); index >= 0 && !recursive {
		base = prefix[:index+1]
	}
	for {
		response, ok := s.execute("s3", "ListObjectsV2", input)
		if !ok {
			return
		}
		output, _ := response.Response.Output.(map[string]any)
		commonPrefixes, _ := output["CommonPrefixes"].([]any)
		for _, item := range commonPrefixes {
			entry, _ := item.(map[string]any)
			name, _ := entry["Prefix"].(string)
			fmt.Fprintf(&s.stdout, "%30s %s\n", "PRE", strings.TrimPrefix(name, base))
		}
		contents, _ := output["Contents"].([]any)
		for _, item := range contents {
			object, _ := item.(map[string]any)
			key, _ := object["Key"].(string)
			modified, _ := object["LastModified"].(string)
			fmt.Fprintf(&s.stdout, "%s %10v %s\n", cliTime(modified), object["Size"], strings.TrimPrefix(key, base))
		}
		token, _ := output["NextContinuationToken"].(string)
		if truncated, _ := output["IsTruncated"].(bool); !truncated || token == "" {
			return
		}
		input["ContinuationToken"] = token
	}
}

func (s *session) deleteAllObjects(bucket string) bool {
	for {
		response, ok := s.execute("s3", "ListObjectsV2", map[string]any{"Bucket": bucket})
		if !ok {
			return false
		}
		output, _ := response.Response.Output.(map[string]any)
		contents, _ := output["Contents"].([]any)
		if len(contents) == 0 {
			return true
		}
		for _, item := range contents {
			object, _ := item.(map[string]any)
			key, _ := object["Key"].(string)
			if _, ok := s.execute("s3", "DeleteObject", map[string]any{"Bucket": bucket, "Key": key}); !ok {
				return false
			}
			fmt.Fprintf(&s.stdout, "delete: s3://%s/%s\n", bucket, key)
		}
	}
}

// cliTime renders an RFC 3339 timestamp like the AWS CLI: "2026-09-25 12:00:00".
func cliTime(value string) string {
	parsed, err := time.Parse(time.RFC3339, value)
	if err != nil {
		return value
	}
	return parsed.UTC().Format("2006-01-02 15:04:05")
}
