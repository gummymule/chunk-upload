package upload

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log"
	"strings"

	"github.com/google/uuid"

	"chunk-upload/internal/config"
	"chunk-upload/internal/storage"
)

type Service struct {
	repo  *Repository
	store storage.Storage
	cfg   config.Config
}

func NewService(repo *Repository, store storage.Storage, cfg config.Config) *Service {
	return &Service{repo: repo, store: store, cfg: cfg}
}

// Limits mengembalikan ukuran file maksimum dan ukuran chunk maksimum (byte).
func (s *Service) Limits() (maxFileSize, chunkSize int64) {
	return s.cfg.MaxFileSize, s.cfg.ChunkSize
}

type InitInput struct {
	Filename    string `json:"filename"`
	Size        int64  `json:"size"`
	MimeType    string `json:"mimeType"`
	ChunkSize   int64  `json:"chunkSize"`
	TotalChunks int    `json:"totalChunks"`
}

func (s *Service) Init(ctx context.Context, input InitInput) (Upload, error) {
	name := strings.TrimSpace(input.Filename)
	switch {
	case name == "" || len(name) > 255:
		return Upload{}, invalid("filename tidak valid")
	case input.Size <= 0:
		return Upload{}, invalid("size harus lebih besar dari 0")
	case input.Size > s.cfg.MaxFileSize:
		return Upload{}, ErrTooLarge
	case input.ChunkSize <= 0 || input.ChunkSize > s.cfg.ChunkSize:
		return Upload{}, invalid(fmt.Sprintf("chunkSize harus lebih besar dari 0 dan tidak melebihi %d", s.cfg.ChunkSize))
	}

	expected := int((input.Size + input.ChunkSize - 1) / input.ChunkSize)
	if input.TotalChunks != expected {
		return Upload{}, invalid(fmt.Sprintf("totalChunks harus sama dengan %d", expected))
	}

	mime := strings.TrimSpace(input.MimeType)
	if mime == "" {
		mime = "application/octet-stream"
	}

	upload := Upload{
		ID:          uuid.NewString(),
		Filename:    name,
		Size:        input.Size,
		MimeType:    mime,
		ChunkSize:   input.ChunkSize,
		TotalChunks: input.TotalChunks,
		Status:      StatusUploading,
	}
	if err := s.repo.Create(ctx, upload); err != nil {
		return Upload{}, err
	}
	return upload, nil
}

func (s *Service) SaveChunk(ctx context.Context, id string, index int, body io.Reader) (int64, error) {
	upload, err := s.get(ctx, id)
	if err != nil {
		return 0, err
	}
	if upload.Status != StatusUploading {
		return 0, ErrNotUploading
	}
	if index < 0 || index >= upload.TotalChunks {
		return 0, invalid(fmt.Sprintf("index harus antara 0 dan %d", upload.TotalChunks-1))
	}

	expected := upload.ChunkSize
	if index == upload.TotalChunks-1 {
		expected = upload.Size - upload.ChunkSize*int64(upload.TotalChunks-1)
	}

	if err := s.store.SaveChunk(upload.ID, index, body, expected); err != nil {
		if errors.Is(err, storage.ErrSizeMismatch) {
			return 0, invalid(fmt.Sprintf("chunk %d harus berukuran %d bytes", index, expected))
		}
		return 0, err
	}
	if err := s.repo.UpsertChunk(ctx, upload.ID, index, expected); err != nil {
		return 0, err
	}
	return expected, nil
}

func (s *Service) Status(ctx context.Context, id string) (Upload, []int, error) {
	upload, err := s.get(ctx, id)
	if err != nil {
		return Upload{}, nil, err
	}
	received, err := s.repo.ReceivedChunks(ctx, upload.ID)
	return upload, received, err
}

func (s *Service) get(ctx context.Context, id string) (Upload, error) {
	parsed, err := uuid.Parse(id)
	if err != nil {
		return Upload{}, ErrNotFound
	}
	return s.repo.Get(ctx, parsed.String())
}

type CompleteResult struct {
	FileID   string `json:"fileId"`
	Filename string `json:"filename"`
	Size     int64  `json:"size"`
	SHA256   string `json:"sha256"`
}

func (s *Service) Complete(ctx context.Context, id string) (CompleteResult, error) {
	u, err := s.get(ctx, id)
	if err != nil {
		return CompleteResult{}, err
	}
	if u.Status != StatusUploading {
		return CompleteResult{}, ErrNotUploading
	}

	received, err := s.repo.ReceivedChunks(ctx, u.ID)
	if err != nil {
		return CompleteResult{}, err
	}
	if missing := missingChunks(received, u.TotalChunks); len(missing) > 0 {
		return CompleteResult{}, &IncompleteError{Missing: missing}
	}

	// Kunci upload: uploading -> completing. Selama completing, chunk baru
	// ditolak dan complete kedua akan gagal.
	ok, err := s.repo.SetStatus(ctx, u.ID, StatusUploading, StatusCompleting)
	if err != nil {
		return CompleteResult{}, err
	}
	if !ok {
		return CompleteResult{}, ErrNotUploading
	}

	// Pekerjaan di bawah harus tuntas walau client memutus koneksi di tengah jalan.
	bg := context.WithoutCancel(ctx)

	sum, err := s.store.Assemble(u.ID, u.TotalChunks, u.Size, u.ID)
	if err != nil {
		if _, rerr := s.repo.SetStatus(bg, u.ID, StatusCompleting, StatusUploading); rerr != nil {
			log.Printf("kembalikan status %s: %v", u.ID, rerr)
		}
		return CompleteResult{}, err
	}

	if err := s.repo.MarkCompleted(bg, u.ID, u.ID); err != nil {
		return CompleteResult{}, err
	}
	if err := s.store.RemoveChunks(u.ID); err != nil {
		log.Printf("hapus chunk sementara %s: %v", u.ID, err)
	}

	return CompleteResult{FileID: u.ID, Filename: u.Filename, Size: u.Size, SHA256: sum}, nil
}

func (s *Service) Cancel(ctx context.Context, id string) error {
	u, err := s.get(ctx, id)
	if err != nil {
		return err
	}
	switch u.Status {
	case StatusCanceled:
		return nil // sudah dibatalkan; DELETE bersifat idempotent
	case StatusUploading:
	default:
		return ErrNotUploading
	}

	ok, err := s.repo.SetStatus(ctx, u.ID, StatusUploading, StatusCanceled)
	if err != nil {
		return err
	}
	if !ok {
		return ErrNotUploading
	}
	if err := s.store.RemoveChunks(u.ID); err != nil {
		log.Printf("hapus chunk sementara %s: %v", u.ID, err)
	}
	return s.repo.DeleteChunks(ctx, u.ID)
}

// File mengembalikan file hasil gabungan. Hanya upload berstatus completed yang bisa diunduh.
func (s *Service) File(ctx context.Context, id string) (Upload, io.ReadSeekCloser, error) {
	u, err := s.get(ctx, id)
	if err != nil {
		return Upload{}, nil, err
	}
	if u.Status != StatusCompleted {
		return Upload{}, nil, ErrNotFound
	}
	f, err := s.store.Open(u.ID)
	if err != nil {
		if errors.Is(err, storage.ErrNotFound) {
			return Upload{}, nil, ErrNotFound
		}
		return Upload{}, nil, err
	}
	return u, f, nil
}

func missingChunks(received []int, total int) []int {
	have := make(map[int]bool, len(received))
	for _, i := range received {
		have[i] = true
	}
	missing := []int{}
	for i := 0; i < total; i++ {
		if !have[i] {
			missing = append(missing, i)
		}
	}
	return missing
}
