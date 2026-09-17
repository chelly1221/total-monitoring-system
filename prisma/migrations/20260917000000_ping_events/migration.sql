-- CreateTable
CREATE TABLE "ping_events" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clientId" TEXT NOT NULL,
    "clientName" TEXT NOT NULL,
    "systemId" TEXT,
    "targetName" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "rttMs" INTEGER,
    "sent" INTEGER NOT NULL DEFAULT 0,
    "lost" INTEGER NOT NULL DEFAULT 0,
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "occurredAt" DATETIME NOT NULL,
    "receivedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "ping_events_clientId_address_occurredAt_status_key" ON "ping_events"("clientId", "address", "occurredAt", "status");

-- CreateIndex
CREATE INDEX "ping_events_systemId_occurredAt_idx" ON "ping_events"("systemId", "occurredAt");

-- CreateIndex
CREATE INDEX "ping_events_receivedAt_idx" ON "ping_events"("receivedAt");
