package main

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"
)

const testTokenSecret = "test-secret"

func signedTokenForTest(t *testing.T, subject string, exp int64) string {
	t.Helper()
	token, err := signToken(testTokenSecret, subject, exp)
	if err != nil {
		t.Fatalf("signToken: %v", err)
	}
	return token
}

func TestSignTokenProducesStandardHS256JWT(t *testing.T) {
	token := signedTokenForTest(t, "admin", time.Now().Add(time.Hour).Unix())

	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		t.Fatalf("token has %d segments, want 3", len(parts))
	}
	if parts[0] != jwtHeaderSegment {
		t.Errorf("header segment = %q", parts[0])
	}

	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		t.Fatalf("decode payload: %v", err)
	}
	var claims tokenClaims
	if err := json.Unmarshal(payload, &claims); err != nil {
		t.Fatalf("unmarshal claims: %v", err)
	}
	if claims.Subject != "admin" {
		t.Errorf("sub = %q", claims.Subject)
	}
}

// The exact token below was produced by Hono's sign({sub:"admin", exp:...},
// "test-secret") from functions/auth.ts. It proves both implementations accept
// each other's sessions when they share JWT_SECRET.
func TestVerifyTokenAcceptsHonoIssuedToken(t *testing.T) {
	const honoToken = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJhZG1pbiIsImV4cCI6NDEwMjQ0NDgwMH0.xxLd0J7GTgjgVb_16Y2Ervya8R4PpeBFBnfgR9Alj9w"

	if err := verifyToken(honoToken, testTokenSecret); err != nil {
		t.Fatalf("Hono-issued token rejected: %v", err)
	}
	if err := verifyToken(honoToken, "wrong-secret"); !errors.Is(err, errTokenSignature) {
		t.Fatalf("wrong secret error = %v, want invalid signature", err)
	}
}

func TestVerifyTokenRejectsTampering(t *testing.T) {
	token := signedTokenForTest(t, "admin", time.Now().Add(time.Hour).Unix())
	parts := strings.Split(token, ".")

	// Change the subject but keep the original signature.
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		t.Fatalf("decode payload: %v", err)
	}
	var claims map[string]any
	if err := json.Unmarshal(payload, &claims); err != nil {
		t.Fatalf("unmarshal claims: %v", err)
	}
	claims["sub"] = "someone-else"
	forgedPayload, err := json.Marshal(claims)
	if err != nil {
		t.Fatalf("marshal claims: %v", err)
	}
	forged := jwtHeaderSegment + "." + base64.RawURLEncoding.EncodeToString(forgedPayload) + "." + parts[2]
	if err := verifyToken(forged, testTokenSecret); !errors.Is(err, errTokenSignature) {
		t.Errorf("forged payload error = %v, want invalid signature", err)
	}

	// Flip a character in the signature.
	signature := []byte(parts[2])
	if signature[0] == 'A' {
		signature[0] = 'B'
	} else {
		signature[0] = 'A'
	}
	if err := verifyToken(parts[0]+"."+parts[1]+"."+string(signature), testTokenSecret); !errors.Is(err, errTokenSignature) {
		t.Errorf("forged signature error = %v, want invalid signature", err)
	}
}

func TestVerifyTokenRejectsExpiredAndMissingExpiry(t *testing.T) {
	expired := signedTokenForTest(t, "admin", time.Now().Add(-time.Minute).Unix())
	if err := verifyToken(expired, testTokenSecret); !errors.Is(err, errTokenExpired) {
		t.Errorf("expired token error = %v, want expired", err)
	}

	// A token whose payload has no exp decodes exp as 0 and is rejected.
	noExpiry, err := signToken(testTokenSecret, "admin", 0)
	if err != nil {
		t.Fatalf("signToken: %v", err)
	}
	if err := verifyToken(noExpiry, testTokenSecret); !errors.Is(err, errTokenExpired) {
		t.Errorf("missing exp error = %v, want expired", err)
	}
}

func TestVerifyTokenRejectsMalformedInput(t *testing.T) {
	noneHeader := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"none","typ":"JWT"}`))
	validPayload := base64.RawURLEncoding.EncodeToString([]byte(`{"sub":"admin","exp":4102444800}`))
	validSignature := jwtSignature(testTokenSecret, jwtHeaderSegment+"."+validPayload)

	signedInvalidBase64 := jwtSignature(testTokenSecret, jwtHeaderSegment+".!!!")
	invalidJSONPayload := base64.RawURLEncoding.EncodeToString([]byte(`not-json`))
	signedInvalidJSON := jwtSignature(testTokenSecret, jwtHeaderSegment+"."+invalidJSONPayload)

	cases := map[string]string{
		"empty":            "",
		"two segments":     jwtHeaderSegment + "." + validPayload,
		"four segments":    jwtHeaderSegment + "." + validPayload + "." + validSignature + ".extra",
		"wrong header":     noneHeader + "." + validPayload + "." + validSignature,
		"no signature":     jwtHeaderSegment + "." + validPayload + ".",
		"invalid base64":   jwtHeaderSegment + ".!!!." + signedInvalidBase64,
		"payload not json": jwtHeaderSegment + "." + invalidJSONPayload + "." + signedInvalidJSON,
		"too long":         strings.Repeat("a", maxTokenBytes+1),
	}
	for name, token := range cases {
		t.Run(name, func(t *testing.T) {
			if err := verifyToken(token, testTokenSecret); !errors.Is(err, errTokenMalformed) {
				t.Errorf("error = %v, want malformed", err)
			}
		})
	}
}

func TestVerifyTokenRejectsEmptySubject(t *testing.T) {
	token := signedTokenForTest(t, "", time.Now().Add(time.Hour).Unix())
	if err := verifyToken(token, testTokenSecret); !errors.Is(err, errTokenMalformed) {
		t.Errorf("error = %v, want malformed", err)
	}
}
