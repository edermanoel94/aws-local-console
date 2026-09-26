package audit

import (
	"crypto/rand"
	"encoding/binary"
	"sync"
	"time"
)

const crockford = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

var (
	idMu     sync.Mutex
	lastMs   uint64
	lastRand [10]byte
)

// NewID returns prefix + a ULID: 48-bit millisecond timestamp and 80 random
// bits, Crockford base32 encoded. IDs generated in the same millisecond are
// monotonic, so they sort in creation order.
func NewID(prefix string) string {
	idMu.Lock()
	ms := uint64(time.Now().UnixMilli())
	if ms == lastMs {
		incrementRandom()
	} else {
		lastMs = ms
		_, _ = rand.Read(lastRand[:])
	}
	var raw [16]byte
	binary.BigEndian.PutUint16(raw[0:2], uint16(ms>>32))
	binary.BigEndian.PutUint32(raw[2:6], uint32(ms))
	copy(raw[6:], lastRand[:])
	idMu.Unlock()
	return prefix + encodeULID(raw)
}

func incrementRandom() {
	for i := len(lastRand) - 1; i >= 0; i-- {
		lastRand[i]++
		if lastRand[i] != 0 {
			return
		}
	}
}

// encodeULID encodes 128 bits as 26 base32 characters (first char carries 3 bits).
func encodeULID(raw [16]byte) string {
	var out [26]byte
	var hi, lo uint64
	hi = binary.BigEndian.Uint64(raw[0:8])
	lo = binary.BigEndian.Uint64(raw[8:16])
	for i := 25; i >= 0; i-- {
		out[i] = crockford[lo&31]
		lo = lo>>5 | hi<<59
		hi >>= 5
	}
	return string(out[:])
}
