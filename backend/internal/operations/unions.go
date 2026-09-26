package operations

import (
	"reflect"
	"strings"

	logstypes "github.com/aws/aws-sdk-go-v2/service/cloudwatchlogs/types"
	dynamodbtypes "github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
	iamtypes "github.com/aws/aws-sdk-go-v2/service/iam/types"
	s3types "github.com/aws/aws-sdk-go-v2/service/s3/types"
)

// Smithy unions are Go interfaces implemented by one struct per member, named
// "<Union>Member<Tag>" with a single exported field "Value". Go reflection
// cannot enumerate the implementations of an interface, so input-side union
// members are registered here. On the wire (our JSON) a union is an object with
// exactly one key, the member tag, e.g. DynamoDB {"S": "text"}.
var unionMembers = []any{
	&dynamodbtypes.AttributeValueMemberB{},
	&dynamodbtypes.AttributeValueMemberBOOL{},
	&dynamodbtypes.AttributeValueMemberBS{},
	&dynamodbtypes.AttributeValueMemberL{},
	&dynamodbtypes.AttributeValueMemberM{},
	&dynamodbtypes.AttributeValueMemberN{},
	&dynamodbtypes.AttributeValueMemberNS{},
	&dynamodbtypes.AttributeValueMemberNULL{},
	&dynamodbtypes.AttributeValueMemberS{},
	&dynamodbtypes.AttributeValueMemberSS{},
	&s3types.AnalyticsFilterMemberAnd{},
	&s3types.AnalyticsFilterMemberPrefix{},
	&s3types.AnalyticsFilterMemberTag{},
	&s3types.MetricsFilterMemberAccessPointArn{},
	&s3types.MetricsFilterMemberAnd{},
	&s3types.MetricsFilterMemberPrefix{},
	&s3types.MetricsFilterMemberTag{},
	&s3types.ObjectEncryptionMemberSSEKMS{},
	&iamtypes.PolicyIdentifierMemberInlinePolicyIdentifier{},
	&iamtypes.PolicyIdentifierMemberPolicyArn{},
	&iamtypes.PolicyIdentifierMemberPolicyType{},
	&logstypes.IntegrationDetailsMemberOpenSearchIntegrationDetails{},
	&logstypes.ResourceConfigMemberOpenSearchResourceConfig{},
}

// unionIndex maps a union interface type to its members keyed by tag.
type unionIndex map[reflect.Type]map[string]reflect.Type

// unionInterfaces lists the union interface types, used to match members.
var unionInterfaces = []reflect.Type{
	reflect.TypeFor[dynamodbtypes.AttributeValue](),
	reflect.TypeFor[s3types.AnalyticsFilter](),
	reflect.TypeFor[s3types.MetricsFilter](),
	reflect.TypeFor[s3types.ObjectEncryption](),
	reflect.TypeFor[iamtypes.PolicyIdentifier](),
	reflect.TypeFor[logstypes.IntegrationDetails](),
	reflect.TypeFor[logstypes.ResourceConfig](),
}

var unions = buildUnionIndex()

func buildUnionIndex() unionIndex {
	index := unionIndex{}
	for _, member := range unionMembers {
		memberType := reflect.TypeOf(member)
		for _, iface := range unionInterfaces {
			if !memberType.Implements(iface) || !strings.HasPrefix(memberType.Elem().Name(), iface.Name()+"Member") {
				continue
			}
			if index[iface] == nil {
				index[iface] = map[string]reflect.Type{}
			}
			index[iface][unionTag(memberType)] = memberType
		}
	}
	return index
}

// unionTag returns the member tag of a union member type ("S" for AttributeValueMemberS),
// or "" when the type is not a union member.
func unionTag(t reflect.Type) string {
	if t.Kind() == reflect.Pointer {
		t = t.Elem()
	}
	_, tag, ok := strings.Cut(t.Name(), "Member")
	if !ok || t.Kind() != reflect.Struct {
		return ""
	}
	if _, hasValue := t.FieldByName("Value"); !hasValue {
		return ""
	}
	return tag
}
