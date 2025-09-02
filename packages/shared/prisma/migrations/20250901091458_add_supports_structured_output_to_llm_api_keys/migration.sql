-- AlterTable
ALTER TABLE "llm_api_keys" ADD COLUMN     "supports_structured_output" BOOLEAN NOT NULL DEFAULT true;
