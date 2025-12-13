package toggly

import (
	"bytes"
	"encoding/json"
	"fmt"
)

func jsonUnmarshalUseNumber(b []byte, v any) error {
	dec := json.NewDecoder(bytes.NewReader(b))
	dec.UseNumber()
	if err := dec.Decode(v); err != nil {
		return fmt.Errorf("json decode: %w", err)
	}
	return nil
}
