-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_sirens" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ip" TEXT NOT NULL,
    "port" INTEGER NOT NULL,
    "protocol" TEXT NOT NULL DEFAULT 'tcp',
    "messageOn" TEXT NOT NULL DEFAULT '',
    "messageOff" TEXT NOT NULL DEFAULT '',
    "location" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_sirens" ("id", "ip", "port", "protocol", "messageOn", "messageOff", "location", "isEnabled", "createdAt", "updatedAt") SELECT "id", "ip", "port", "protocol", "message", '', "location", "isEnabled", "createdAt", "updatedAt" FROM "sirens";
DROP TABLE "sirens";
ALTER TABLE "new_sirens" RENAME TO "sirens";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
