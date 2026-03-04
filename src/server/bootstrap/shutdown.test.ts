import type http from "node:http";
import { describe, expect, it, vi } from "vitest";
import type { WorkerRepository } from "../persistence/workerRepository";
import type { StatusMonitor } from "../status/statusMonitor";
import { createShutdownHandler } from "./shutdown";

describe("createShutdownHandler", () => {
  it("stops monitor, closes server, closes workers, then exits", async () => {
    const statusMonitor = {
      stop: vi.fn()
    } as unknown as StatusMonitor;
    const server = {
      close: vi.fn((callback: (error?: Error) => void) => {
        callback();
      })
    } as unknown as http.Server;
    const workers = {
      close: vi.fn()
    } as unknown as WorkerRepository;
    const exit = vi.fn();

    const shutdown = createShutdownHandler({
      statusMonitor,
      server,
      workers,
      timeoutMs: 250,
      exit
    });

    await shutdown();

    expect((statusMonitor.stop as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
    expect((server.close as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
    expect((workers.close as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);

    const stopOrder = (statusMonitor.stop as unknown as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0] ?? 0;
    const closeOrder = (server.close as unknown as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0] ?? 0;
    const workersOrder = (workers.close as unknown as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0] ?? 0;
    const exitOrder = (exit as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0] ?? 0;
    expect(stopOrder).toBeLessThan(closeOrder);
    expect(closeOrder).toBeLessThan(workersOrder);
    expect(workersOrder).toBeLessThan(exitOrder);
  });

  it("runs shutdown cleanup only once for duplicate invocations", async () => {
    const statusMonitor = {
      stop: vi.fn()
    } as unknown as StatusMonitor;
    const server = {
      close: vi.fn((callback: (error?: Error) => void) => {
        callback();
      })
    } as unknown as http.Server;
    const workers = {
      close: vi.fn()
    } as unknown as WorkerRepository;
    const exit = vi.fn();

    const shutdown = createShutdownHandler({
      statusMonitor,
      server,
      workers,
      timeoutMs: 250,
      exit
    });

    await Promise.all([shutdown(), shutdown()]);

    expect((statusMonitor.stop as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
    expect((server.close as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
    expect((workers.close as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it("exits with timeout fallback when server close never resolves", async () => {
    vi.useFakeTimers();

    const statusMonitor = {
      stop: vi.fn()
    } as unknown as StatusMonitor;
    const server = {
      close: vi.fn((_callback: (error?: Error) => void) => {
        // Never calls back.
      })
    } as unknown as http.Server;
    const workers = {
      close: vi.fn()
    } as unknown as WorkerRepository;
    const exit = vi.fn();

    const shutdown = createShutdownHandler({
      statusMonitor,
      server,
      workers,
      timeoutMs: 50,
      exit
    });

    const pending = shutdown();
    await vi.advanceTimersByTimeAsync(50);
    await pending;

    expect(exit).toHaveBeenCalledWith(1);
    expect((workers.close as unknown as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();

    vi.useRealTimers();
  });
});
