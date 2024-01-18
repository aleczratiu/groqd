import { primitiveValidation } from "./primitives";
import { sanityValidation } from "./sanity-content-blocks";
import { objectValidation } from "./object-shape";
import { arrayValidation } from "./array-shape";

export const validation = {
  ...primitiveValidation,
  ...sanityValidation,
  ...objectValidation,
  ...arrayValidation,
};