-- AlterTable
ALTER TABLE "Restaurante" ALTER COLUMN "plano" SET DEFAULT 'FREE',
ADD COLUMN     "documento" TEXT,
ADD COLUMN     "ipCadastro" TEXT,
ADD COLUMN     "suspensoEm" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Usuario" ADD COLUMN     "emailVerificadoEm" TIMESTAMP(3),
ADD COLUMN     "superAdmin" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "TokenVerificacaoEmail" (
    "id" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiraEm" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TokenVerificacaoEmail_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TokenVerificacaoEmail_tokenHash_key" ON "TokenVerificacaoEmail"("tokenHash");

-- CreateIndex
CREATE INDEX "TokenVerificacaoEmail_usuarioId_idx" ON "TokenVerificacaoEmail"("usuarioId");

-- CreateIndex
CREATE UNIQUE INDEX "Restaurante_documento_key" ON "Restaurante"("documento");

-- AddForeignKey
ALTER TABLE "TokenVerificacaoEmail" ADD CONSTRAINT "TokenVerificacaoEmail_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Dados: quem já usava o sistema antes da verificação de e-mail existir não
-- pode ficar travado — considera esses e-mails verificados.
UPDATE "Usuario" SET "emailVerificadoEm" = now() WHERE "emailVerificadoEm" IS NULL;

-- Dados: e-mail passa a ser normalizado (trim + lowercase) na entrada. Se
-- houver duas contas que só diferem em maiúsculas, a constraint única de
-- email faz este UPDATE falhar e a migration aborta inteira — resolver a
-- duplicata manualmente antes de rodar de novo.
UPDATE "Usuario" SET "email" = lower(trim("email")) WHERE "email" <> lower(trim("email"));
