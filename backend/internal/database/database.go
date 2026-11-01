package database

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"

	_ "modernc.org/sqlite"
)

const schema = `
CREATE TABLE IF NOT EXISTS uploads (
	id TEXT PRIMARY KEY,
	filename TEXT NO NULL,
	size INTEGER NOT NULL,
	mime_type TEXT NOT NULL,
	chunk_size INTEGER NOT NULL,
	total_chunks INTEGER NOT NULL, 
	status TEXT NOT NULL DEFAULT 'uploading',
	final_key TEXT,
	created_at TEXT NOT NULL DEFAULT (datetime('now')),
	updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS upload_chunks (
	upload_id TEXT NOT NULL REFERENCES uploads(id) ON DELETE CASCADE,
	idx INTEGER NOT NULL,
	size INTEGER NOT NULL,
	PRIMARY KEY (upload_id, idx)
);
`

func Open(path string) (*sql.DB, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, err
	}

	dsn := fmt.Sprintf(
		"file:%s?_pragma=foreign_keys(1)&_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)",
		filepath.ToSlash(path),
	)
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)

	if _, err := db.Exec(schema); err != nil {
		db.Close()
		return nil, err
	}
	return db, nil
}
