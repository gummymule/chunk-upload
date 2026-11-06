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
		Handler:           withCORS(mux, cfg.CORSOrigin),
		ReadHeaderTimeout: 10 * time.Second,
	}
	log.Printf("server berjalan di :%s", cfg.Port)
	log.Fatal(srv.ListenAndServe())
}

// withCORS mengizinkan frontend (origin lain) memanggil API. Preflight OPTIONS
// harus dijawab di sini karena ServeMux membalas 405 untuk method yang tidak
// terdaftar pada pola route.
func withCORS(next http.Handler, origin string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Add("Vary", "Origin")
		if origin == "*" || r.Header.Get("Origin") == origin {
			h.Set("Access-Control-Allow-Origin", origin)
			h.Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
			h.Set("Access-Control-Allow-Headers", "Content-Type")
			h.Set("Access-Control-Max-Age", "600")
		}
		if r.Method == http.MethodOptions && r.Header.Get("Access-Control-Request-Method") != "" {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}
