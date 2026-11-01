package main

import (
	"log"
	"net/http"
	"time"

	"chunk-upload/internal/config"
	"chunk-upload/internal/database"
	"chunk-upload/internal/storage"
	"chunk-upload/internal/upload"
)

func main() {
	cfg := config.Load()

	db, err := database.Open(cfg.DBPath)
	if err != nil {
		log.Fatalf("buka database: %v", err)
	}
	defer db.Close()

	store, err := storage.NewLocal(cfg.StorageDir)
	if err != nil {
		log.Fatalf("siapkan storage: %v", err)
	}

	repo := upload.NewRepository(db)
	svc := upload.NewService(repo, store, cfg)
	handler := upload.NewHandler(svc)

	mux := http.NewServeMux()
	handler.Register(mux)

	srv := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           mux,
		ReadHeaderTimeout: 10 * time.Second,
	}
	log.Printf("server berjalan di :%s", cfg.Port)
	log.Fatal(srv.ListenAndServe())
}
