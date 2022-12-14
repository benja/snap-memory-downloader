import { spawnSync } from "child_process";
import dayjs from "dayjs";
import { PathLike } from "fs";
import fs from "fs/promises";
import fsSync from "fs";
import { Ora } from "ora";
import path, { dirname } from "path";
import { fileURLToPath } from "url";

export type Memory = {
  Date: string;
  "Media Type": "Video" | "Image";
  "Download Link": string;
};

export type AppState = {
  spinner: Ora;
  currently: number;
};

export const MAX_PARALLELL_PROCESSING_AMOUNT = 4;
export const __dirname = dirname(fileURLToPath(import.meta.url));
export const memoriesFolder = path.resolve(path.join(__dirname, "../memories"));

export async function makeFolderIfNotExists(path: string) {
  if (fsSync.existsSync(path)) return;

  try {
    await fs.mkdir(path);
  } catch (err) {
    console.log("Could not make folder", path);
  }
}

export async function updateFileMetadata(path: string, date: string) {
  try {
    await fs.utimes(path, dayjs(date).toDate(), dayjs(date).toDate());
  } catch (err) {
    console.log("Could not set file stats", path);
  }
}

export async function removeFile(path: PathLike) {
  try {
    await fs.unlink(path);
  } catch (err) {
    console.log("Could not delete file", path);
  }
}

export function getVideoDuration(folder: string, file: string) {
  const output = spawnSync("ffprobe", [
    "-i",
    path.join(memoriesFolder, folder, file),
    "-loglevel",
    "0",
    "-print_format",
    "json",
    "-show_streams",
  ]);

  const stringOutput = output.stdout.toString("utf-8");
  const jsonOutput = JSON.parse(stringOutput);

  return parseFloat(
    jsonOutput["streams"]?.filter(
      (stream) => stream["codec_type"] == "video"
    )[0]["duration"]
  );
}

export function getDateFromVideoName(fileName: string) {
  return fileName.substring(0, 19);
}

export function chunkArray<T>(array: T[], chunkAmount: number): T[][] {
  const chunkedArray: T[][] = [];

  for (let i = 0; i < array.length; i += chunkAmount) {
    const chunk = array.slice(i, i + chunkAmount);
    chunkedArray.push(chunk);
  }

  return chunkedArray;
}
