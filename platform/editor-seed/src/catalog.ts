/**
 * The components catalog (contracts/components_catalog.json — OWNED by this
 * repo, generated from the overlay registry). The picker and props forms are
 * driven by it, so the UI can only ever produce overlays that validate.
 */

import catalogJson from "../../contracts/components_catalog.json";
import type { ObjectSchema } from "./components/PropsForm";

export interface CatalogEntry {
  component: string;
  description: string;
  props: ObjectSchema;
}

export const CATALOG_OVERLAYS: CatalogEntry[] = (
  catalogJson as { overlays: CatalogEntry[] }
).overlays;

export function catalogEntry(component: string): CatalogEntry | undefined {
  return CATALOG_OVERLAYS.find((entry) => entry.component === component);
}
