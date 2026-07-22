import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import YAML, { isMap, isScalar, isSeq } from "yaml";
import type { PromptSignature } from "../../shared/types";
import { partialConfigSchema } from "../config/schema";

export interface PromptSignatureFileSystem {
  readFile(path: string, encoding: "utf8"): Promise<string>;
  writeFile(path: string, content: string, encoding: "utf8"): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  unlink(path: string): Promise<void>;
  stat(path: string): Promise<{ mode: number }>;
  chmod(path: string, mode: number): Promise<void>;
}

const nodeFileSystem: PromptSignatureFileSystem = fs;

export async function appendPromptSignature(
  localOverridePath: string,
  signature: PromptSignature,
  fileSystem: PromptSignatureFileSystem = nodeFileSystem
): Promise<void> {
  const [raw, existingMode] = await Promise.all([
    readOptionalFile(localOverridePath, fileSystem),
    readOptionalMode(localOverridePath, fileSystem)
  ]);
  const document = YAML.parseDocument(raw);
  if (document.errors.length > 0) {
    throw new Error(`Invalid YAML in ${localOverridePath}: ${document.errors[0].message}`);
  }

  validatePartialConfig(document.toJS() ?? {}, localOverridePath);
  const existingExtras = document.getIn(["status", "extraPromptSignatures"], true);
  if (
    isSeq(existingExtras) &&
    existingExtras.items.some((item) => {
      if (!isMap(item)) return false;
      const itemId = item.get("id", true);
      return isScalar(itemId) && itemId.value === signature.id;
    })
  ) {
    throw new Error(`Prompt signature id '${signature.id}' already exists in ${localOverridePath}.`);
  }

  if (existingExtras === undefined) {
    if (document.get("status", true) === undefined) {
      document.set("status", document.createNode({}));
    }
    document.setIn(["status", "extraPromptSignatures"], document.createNode([signature]));
  } else if (isSeq(existingExtras)) {
    existingExtras.add(document.createNode(signature));
  } else {
    throw new Error(`Invalid config in ${localOverridePath}: status.extraPromptSignatures must be a list.`);
  }

  validatePartialConfig(document.toJS() ?? {}, localOverridePath);
  const tempPath = path.join(
    path.dirname(localOverridePath),
    `.${path.basename(localOverridePath)}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`
  );
  try {
    await fileSystem.writeFile(tempPath, document.toString(), "utf8");
    if (existingMode !== undefined) {
      await fileSystem.chmod(tempPath, existingMode);
    }
    await fileSystem.rename(tempPath, localOverridePath);
  } catch (error) {
    try {
      await fileSystem.unlink(tempPath);
    } catch (cleanupError) {
      if (!isMissingFileError(cleanupError)) {
        throw new AggregateError([error, cleanupError], `Failed to update ${localOverridePath} and clean up ${tempPath}.`);
      }
    }
    throw error;
  }
}

function validatePartialConfig(value: unknown, filePath: string): void {
  const parsed = partialConfigSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`Invalid config in ${filePath}: ${parsed.error.issues[0]?.message ?? "schema validation failed"}`);
  }
}

async function readOptionalFile(filePath: string, fileSystem: PromptSignatureFileSystem): Promise<string> {
  try {
    return await fileSystem.readFile(filePath, "utf8");
  } catch (error: unknown) {
    if (isMissingFileError(error)) {
      return "";
    }
    throw error;
  }
}

async function readOptionalMode(filePath: string, fileSystem: PromptSignatureFileSystem): Promise<number | undefined> {
  try {
    return (await fileSystem.stat(filePath)).mode & 0o7777;
  } catch (error: unknown) {
    if (isMissingFileError(error)) {
      return undefined;
    }
    throw error;
  }
}

function isMissingFileError(error: unknown): error is { code: unknown } {
  return error !== null && typeof error === "object" && "code" in error && error.code === "ENOENT";
}
