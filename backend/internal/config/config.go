package config

import (
	"os"
	"strconv"
)

type Config struct {
	Port        string
	DBPath      string
	StorageDir  string
	MaxFileSize int64
	ChunkSize   int64
	// CORSOrigin adalah origin frontend yang boleh memanggil API (mis. http://localhost:3000).
	CORSOrigin string
}

func Load() Config {
	return Config{
		CORSOrigin:  getEnv("CORS_ORIGIN", "http://localhost:3000"),
		Port:        getEnv("PORT", "8080"),
		DBPath:      getEnv("DB_PATH", "./data/app.db"),
		StorageDir:  getEnv("STORAGE_DIR", "./data"),
		MaxFileSize: getEnvInt64("MAX_FILE_SIZE", 20*1024*1024),
		ChunkSize:   getEnvInt64("CHUNK_SIZE", 1024*1024),
	}
}

func getEnv(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func getEnvInt64(key string, def int64) int64 {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.ParseInt(v, 10, 64); err == nil && n > 0 {
			return n
		}
	}
	return def
}
