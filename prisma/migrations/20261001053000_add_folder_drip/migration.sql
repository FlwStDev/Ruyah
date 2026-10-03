-- CreateTable
CREATE TABLE "FolderDrip" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Folder drip',
    "folderPath" TEXT NOT NULL,
    "intervalMinutes" INTEGER NOT NULL DEFAULT 60,
    "destinationsJson" TEXT NOT NULL DEFAULT '["x"]',
    "captionMode" TEXT NOT NULL DEFAULT 'filename',
    "captionText" TEXT NOT NULL DEFAULT '',
    "redditSubreddit" TEXT NOT NULL DEFAULT '',
    "afterPost" TEXT NOT NULL DEFAULT 'move',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "nextRunAt" DATETIME,
    "lastRunAt" DATETIME,
    "lastError" TEXT,
    "lastFileName" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "FolderDrip_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FolderDripItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "dripId" TEXT NOT NULL,
    "sourcePath" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "postId" TEXT,
    "lastError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "FolderDripItem_dripId_fkey" FOREIGN KEY ("dripId") REFERENCES "FolderDrip" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "FolderDrip_enabled_nextRunAt_idx" ON "FolderDrip"("enabled", "nextRunAt");

-- CreateIndex
CREATE INDEX "FolderDrip_userId_idx" ON "FolderDrip"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "FolderDripItem_dripId_sourcePath_key" ON "FolderDripItem"("dripId", "sourcePath");

-- CreateIndex
CREATE INDEX "FolderDripItem_dripId_status_idx" ON "FolderDripItem"("dripId", "status");
