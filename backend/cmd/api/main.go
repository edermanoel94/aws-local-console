// Command api runs the AWS Local Console Go API.
package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/edermanoel94/aws-local-console/backend/internal/api"
	"github.com/edermanoel94/aws-local-console/backend/internal/architecture"
	"github.com/edermanoel94/aws-local-console/backend/internal/audit"
	awsfloci "github.com/edermanoel94/aws-local-console/backend/internal/aws"
	"github.com/edermanoel94/aws-local-console/backend/internal/cli"
	"github.com/edermanoel94/aws-local-console/backend/internal/coverage"
	"github.com/edermanoel94/aws-local-console/backend/internal/environments"
	"github.com/edermanoel94/aws-local-console/backend/internal/logging"
	"github.com/edermanoel94/aws-local-console/backend/internal/operations"
	"github.com/edermanoel94/aws-local-console/backend/internal/resources"
	"github.com/edermanoel94/aws-local-console/backend/internal/services"
)

const auditCapacity = 2000

func main() {
	level, levelErr := logging.ParseLevel(os.Getenv("LOG_LEVEL"))
	logger := logging.New(os.Stdout, level)
	slog.SetDefault(logger)
	if levelErr != nil {
		logger.Warn("invalid LOG_LEVEL, logging at INFO", "error", levelErr)
	}

	cfg := environments.Load()
	factory := awsfloci.NewFactory(cfg)
	registry := services.NewRegistry(factory)

	started := time.Now()
	catalog := operations.NewCatalog(registry, cfg.DefaultRegion)
	logger.Info("operation catalog ready", "services", len(registry.All()), "durationMs", time.Since(started).Milliseconds())

	tracker := coverage.NewTracker()
	store := audit.NewStore(auditCapacity, cfg.AccountID)
	engine := operations.NewEngine(registry, catalog, tracker, store, cfg.DefaultRegion, logger)
	discoverer := resources.NewDiscoverer(registry, cfg.AccountID, cfg.RegionNames(), logger)

	handler := api.NewHandler(api.Dependencies{
		Config:       cfg,
		Factory:      factory,
		Registry:     registry,
		Catalog:      catalog,
		Coverage:     tracker,
		Audit:        store,
		Engine:       engine,
		Discoverer:   discoverer,
		Architecture: architecture.NewBuilder(discoverer),
		CLI:          cli.NewRunner(engine, registry, cfg.DefaultRegion),
		Floci:        awsfloci.NewFlociMonitor(factory, 5*time.Second, logger),
		Logger:       logger,
	})

	server := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           handler,
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       2 * time.Minute,
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	go func() {
		logger.Info("AWS Local Console API listening", "addr", server.Addr, "floci", cfg.FlociEndpoint, "region", cfg.DefaultRegion, "corsOrigins", cfg.CORSOrigins, "logLevel", logging.LevelName(level))
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.Error("server failed", "error", err)
			os.Exit(1)
		}
	}()
	<-ctx.Done()
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = server.Shutdown(shutdownCtx)
	logger.Info("server stopped")
}
