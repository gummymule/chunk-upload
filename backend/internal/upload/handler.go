package upload

import (
	"encoding/json"
	"errors"
	"log"
	"mime"
	"net/http"
	"strconv"
	"time"
)

type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

func (h *Handler) Register(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/uploads", h.handleInit)
	mux.HandleFunc("PUT /api/uploads/{id}/chunks/{index}", h.handlePutChunk)
	mux.HandleFunc("GET /api/uploads/{id}", h.handleStatus)
	mux.HandleFunc("POST /api/uploads/{id}/complete", h.handleComplete) // baru
	mux.HandleFunc("DELETE /api/uploads/{id}", h.handleCancel)          // baru
	mux.HandleFunc("GET /api/files/{id}", h.handleDownload)
}

func (h *Handler) handleInit(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	var in InitInput
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(&in); err != nil {
		writeError(w, invalid("body JSON tidak valid"))
		return
	}

	u, err := h.svc.Init(r.Context(), in)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{
		"uploadId":    u.ID,
		"chunkSize":   u.ChunkSize,
		"totalChunks": u.TotalChunks,
	})
}

func (h *Handler) handlePutChunk(w http.ResponseWriter, r *http.Request) {
	index, err := strconv.Atoi(r.PathValue("index"))
	if err != nil {
		writeError(w, invalid("index harus berupa angka"))
		return
	}

	size, err := h.svc.SaveChunk(r.Context(), r.PathValue("id"), index, r.Body)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"index": index, "size": size})
}

func (h *Handler) handleStatus(w http.ResponseWriter, r *http.Request) {
	u, received, err := h.svc.Status(r.Context(), r.PathValue("id"))
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"uploadId":       u.ID,
		"filename":       u.Filename,
		"size":           u.Size,
		"status":         u.Status,
		"chunkSize":      u.ChunkSize,
		"totalChunks":    u.TotalChunks,
		"receivedChunks": received,
	})
}

func (h *Handler) handleComplete(w http.ResponseWriter, r *http.Request) {
	res, err := h.svc.Complete(r.Context(), r.PathValue("id"))
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, res)
}

func (h *Handler) handleCancel(w http.ResponseWriter, r *http.Request) {
	if err := h.svc.Cancel(r.Context(), r.PathValue("id")); err != nil {
		writeError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) handleDownload(w http.ResponseWriter, r *http.Request) {
	u, f, err := h.svc.File(r.Context(), r.PathValue("id"))
	if err != nil {
		writeError(w, err)
		return
	}
	defer f.Close()

	w.Header().Set("Content-Type", u.MimeType)
	w.Header().Set("X-Content-Type-Options", "nosniff")
	if cd := mime.FormatMediaType("attachment", map[string]string{"filename": u.Filename}); cd != "" {
		w.Header().Set("Content-Disposition", cd)
	}
	// ServeContent otomatis menangani header Range (resume download / streaming).
	http.ServeContent(w, r, u.Filename, time.Time{}, f)
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, err error) {
	var inv *InvalidError
	var inc *IncompleteError
	switch {
	case errors.As(err, &inv):
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": inv.Msg})
	case errors.As(err, &inc):
		writeJSON(w, http.StatusConflict, map[string]any{
			"error":         inc.Error(),
			"missingChunks": inc.Missing,
		})
	case errors.Is(err, ErrNotFound):
		writeJSON(w, http.StatusNotFound, map[string]string{"error": err.Error()})
	case errors.Is(err, ErrTooLarge):
		writeJSON(w, http.StatusRequestEntityTooLarge, map[string]string{"error": err.Error()})
	case errors.Is(err, ErrNotUploading):
		writeJSON(w, http.StatusConflict, map[string]string{"error": err.Error()})
	default:
		log.Printf("internal error: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "terjadi kesalahan pada server"})
	}
}
