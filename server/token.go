package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"time"
)

// The server signs exactly one JWT profile: HS256 with the standard
// {"alg":"HS256","typ":"JWT"} header. Fixing the header segment (rather than
// negotiating an algorithm) means the fixed profile can be verified without a
// JWT library and without an "alg" confusion surface. The format stays
// compatible with the Hono server: the same secret verifies tokens issued by
// either implementation.
const (
	jwtHeaderSegment = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"
	maxTokenBytes    = 4096
)

var (
	errTokenMalformed = errors.New("token: malformed")
	errTokenSignature = errors.New("token: invalid signature")
	errTokenExpired   = errors.New("token: expired")
)

type tokenClaims struct {
	Subject string `json:"sub"`
	Expires int64  `json:"exp"`
}

func signToken(secret, subject string, exp int64) (string, error) {
	payload, err := json.Marshal(tokenClaims{Subject: subject, Expires: exp})
	if err != nil {
		return "", err
	}
	signingInput := jwtHeaderSegment + "." + base64.RawURLEncoding.EncodeToString(payload)
	return signingInput + "." + jwtSignature(secret, signingInput), nil
}

func jwtSignature(secret, signingInput string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(signingInput))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

func verifyToken(token, secret string) error {
	if len(token) == 0 || len(token) > maxTokenBytes {
		return errTokenMalformed
	}
	parts := strings.Split(token, ".")
	if len(parts) != 3 || parts[0] != jwtHeaderSegment || parts[1] == "" || parts[2] == "" {
		return errTokenMalformed
	}

	expected := jwtSignature(secret, parts[0]+"."+parts[1])
	if !hmac.Equal([]byte(expected), []byte(parts[2])) {
		return errTokenSignature
	}

	// Only parse claims after the signature is verified.
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return errTokenMalformed
	}
	var claims tokenClaims
	if err := json.Unmarshal(payload, &claims); err != nil {
		return errTokenMalformed
	}
	if claims.Subject == "" {
		return errTokenMalformed
	}
	// Missing exp decodes to 0 and is therefore rejected as expired.
	if claims.Expires <= time.Now().Unix() {
		return errTokenExpired
	}
	return nil
}
