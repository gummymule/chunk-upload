package upload

import "errors"

const (
	StatusUploading  = "uploading"
	StatusCompleting = "completing"
	StatusCompleted  = "completed"
	StatusCanceled   = "canceled"
)

type Upload struct {
	ID          string
	Filename    string
	Size        int64
	MimeType    string
	ChunkSize   int64
	TotalChunks int
	Status      string
}

var (
	ErrNotFound     = errors.New("Upload tidak ditemukan")
	ErrTooLarge     = errors.New("Ukuran file melebihi batas maksimum")
	ErrNotUploading = errors.New("Upload sudah tidak aktif")
)

type InvalidError struct{ Msg string }

func (e *InvalidError) Error() string {
	return e.Msg
}

func invalid(msg string) error {
	return &InvalidError{Msg: msg}
}

type IncompleteError struct{ Missing []int }

func (e *IncompleteError) Error() string { return "chunk belum lengkap" }
