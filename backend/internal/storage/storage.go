package storage

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
)

var (
	ErrSizeMismatch = errors.New("ukuran tidak sesuai")
	ErrNotFound     = errors.New("file tidak ditemukan")
)

type Storage interface {
	SaveChunk(uploadID string, index int, r io.Reader, expected int64) error
	// Assemble menggabungkan semua chunk secara streaming dan mengembalikan SHA-256 hasilnya.
	Assemble(uploadID string, totalChunks int, expectedSize int64, finalKey string) (string, error)
	RemoveChunks(uploadID string) error
	Open(key string) (io.ReadSeekCloser, error)
}

type Local struct {
	baseDir string
}

func NewLocal(baseDir string) (*Local, error) {
	for _, d := range []string{"tmp", "files"} {
		if err := os.MkdirAll(filepath.Join(baseDir, d), 0o755); err != nil {
			return nil, err
		}
	}
	return &Local{baseDir: baseDir}, nil
}

func (l *Local) chunkDir(uploadID string) string {
	return filepath.Join(l.baseDir, "tmp", uploadID)
}

func (l *Local) filePath(key string) string {
	return filepath.Join(l.baseDir, "files", key)
}

func partName(index int) string {
	return fmt.Sprintf("%06d.part", index)
}

// SaveChunk menulis ke file sementara dulu, lalu rename. Dengan begitu chunk
// yang gagal di tengah jalan tidak pernah terlihat sebagai chunk "utuh", dan
// mengirim ulang chunk yang sama hanya menimpa file lama (idempotent).
func (l *Local) SaveChunk(uploadID string, index int, r io.Reader, expected int64) error {
	dir := l.chunkDir(uploadID)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}

	tmp, err := os.CreateTemp(dir, "chunk-*.tmp")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()

	// Baca maksimal expected+1 byte: cukup untuk mendeteksi kelebihan data
	// tanpa membaca body yang bisa saja sangat besar.
	n, copyErr := io.Copy(tmp, io.LimitReader(r, expected+1))
	closeErr := tmp.Close()
	if copyErr != nil || closeErr != nil {
		os.Remove(tmpName)
		return errors.Join(copyErr, closeErr)
	}
	if n != expected {
		os.Remove(tmpName)
		return ErrSizeMismatch
	}

	if err := os.Rename(tmpName, filepath.Join(dir, partName(index))); err != nil {
		os.Remove(tmpName)
		return err
	}
	return nil
}

// Assemble menyambung chunk 0..totalChunks-1 ke satu file sementara sambil
// menghitung SHA-256, memverifikasi ukuran total, lalu rename ke nama final.
// File final hanya muncul kalau semuanya berhasil.
func (l *Local) Assemble(uploadID string, totalChunks int, expectedSize int64, finalKey string) (string, error) {
	dir := l.chunkDir(uploadID)

	tmp, err := os.CreateTemp(filepath.Join(l.baseDir, "files"), "assemble-*.tmp")
	if err != nil {
		return "", err
	}
	tmpName := tmp.Name()

	done := false
	defer func() {
		if !done {
			tmp.Close()
			os.Remove(tmpName)
		}
	}()

	hasher := sha256.New()
	w := io.MultiWriter(tmp, hasher)

	var total int64
	for i := 0; i < totalChunks; i++ {
		n, err := copyPart(w, filepath.Join(dir, partName(i)))
		if err != nil {
			return "", fmt.Errorf("chunk %d: %w", i, err)
		}
		total += n
	}
	if total != expectedSize {
		return "", fmt.Errorf("%w: hasil gabungan %d byte, seharusnya %d", ErrSizeMismatch, total, expectedSize)
	}

	if err := tmp.Sync(); err != nil {
		return "", err
	}
	if err := tmp.Close(); err != nil {
		return "", err
	}
	if err := os.Rename(tmpName, l.filePath(finalKey)); err != nil {
		return "", err
	}
	done = true
	return hex.EncodeToString(hasher.Sum(nil)), nil
}

func copyPart(dst io.Writer, path string) (int64, error) {
	f, err := os.Open(path)
	if err != nil {
		return 0, err
	}
	defer f.Close()
	return io.Copy(dst, f)
}

func (l *Local) RemoveChunks(uploadID string) error {
	return os.RemoveAll(l.chunkDir(uploadID))
}

func (l *Local) Open(key string) (io.ReadSeekCloser, error) {
	f, err := os.Open(l.filePath(key))
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return f, nil
}
