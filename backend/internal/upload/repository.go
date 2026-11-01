package upload

import (
	"context"
	"database/sql"
	"errors"
)

type Repository struct {
	db *sql.DB
}

func NewRepository(db *sql.DB) *Repository {
	return &Repository{db: db}
}

func (r *Repository) Create(ctx context.Context, u Upload) error {
	_, err := r.db.ExecContext(ctx,
		`INSERT INTO uploads (id, filename, size, mime_type, chunk_size, total_chunks, status)
		VALUES (?, ?, ?, ?, ?, ?, ?)`,
		u.ID, u.Filename, u.Size, u.MimeType, u.ChunkSize, u.TotalChunks, u.Status)
	return err
}

func (r *Repository) Get(ctx context.Context, id string) (Upload, error) {
	var u Upload
	err := r.db.QueryRowContext(ctx,
		`SELECT id, filename, size, mime_type, chunk_size, total_chunks, status
		FROM uploads WHERE id = ?`, id).
		Scan(&u.ID, &u.Filename, &u.Size, &u.MimeType, &u.ChunkSize, &u.TotalChunks, &u.Status)
	if errors.Is(err, sql.ErrNoRows) {
		return Upload{}, ErrNotFound
	}
	return u, err
}

func (r *Repository) UpsertChunk(ctx context.Context, uploadID string, index int, size int64) error {
	_, err := r.db.ExecContext(ctx,
		`INSERT INTO upload_chunks (upload_id, idx, size) VALUES (?, ?, ?)
		ON CONFLICT(upload_id, idx) DO UPDATE SET size = excluded.size`,
		uploadID, index, size)
	return err
}

func (r *Repository) ReceivedChunks(ctx context.Context, uploadID string) ([]int, error) {
	rows, err := r.db.QueryContext(ctx,
		`SELECT idx FROM upload_chunks WHERE upload_id = ? ORDER BY idx`, uploadID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	received := []int{}
	for rows.Next() {
		var idx int
		if err := rows.Scan(&idx); err != nil {
			return nil, err
		}
		received = append(received, idx)
	}
	return received, rows.Err()
}

func (r *Repository) SetStatus(ctx context.Context, id, from, to string) (bool, error) {
	res, err := r.db.ExecContext(ctx,
		`UPDATE uploads SET status = ?, updated_at = datetime('now')
		 WHERE id = ? AND status = ?`, to, id, from)
	if err != nil {
		return false, err
	}
	n, err := res.RowsAffected()
	return n == 1, err
}

func (r *Repository) MarkCompleted(ctx context.Context, id, finalKey string) error {
	res, err := r.db.ExecContext(ctx,
		`UPDATE uploads SET status = ?, final_key = ?, updated_at = datetime('now')
		 WHERE id = ? AND status = ?`,
		StatusCompleted, finalKey, id, StatusCompleting)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n != 1 {
		return errors.New("status upload berubah saat finalisasi")
	}
	return nil
}

func (r *Repository) DeleteChunks(ctx context.Context, uploadID string) error {
	_, err := r.db.ExecContext(ctx,
		`DELETE FROM upload_chunks WHERE upload_id = ?`, uploadID)
	return err
}
