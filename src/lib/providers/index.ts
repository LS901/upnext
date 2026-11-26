import "server-only";
import { getIgdbDetails } from "./igdb";
import { getTmdbDetails } from "./tmdb";
import type { ItemDetails, MediaType, Provider } from "./types";

export async function getDetails(
  provider: Provider,
  mediaType: MediaType,
  id: string,
): Promise<ItemDetails> {
  if (provider === "tmdb" && (mediaType === "movie" || mediaType === "show")) {
    return getTmdbDetails(mediaType, id);
  }
  if (provider === "igdb" && mediaType === "game") return getIgdbDetails(id);
  throw new Error(`Unsupported provider/media type: ${provider}/${mediaType}`);
}
