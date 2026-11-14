// Units of sale and the category rules that govern them.
// Per-head sales are only allowed for livestock, so other products can't be sold that way.
const LIVESTOCK_ROOT = "Livestock";
const UNITS = ["EACH", "PER_HEAD", "PER_KG", "PER_CRATE"];

// Returns true when a category sits anywhere under the Livestock branch of Agriculture
async function isLivestockCategory(prisma, categoryId) {
  let current = await prisma.category.findUnique({ where: { id: categoryId } });
  while (current) {
    if (current.name === LIVESTOCK_ROOT && current.level === 2) return true;
    if (current.parentId === null) return false;
    current = await prisma.category.findUnique({ where: { id: current.parentId } });
  }
  return false;
}

// Checks a unit for a product in a category. Returns an error message, or null if it's allowed.
async function checkUnit(prisma, unit, categoryId) {
  if (!UNITS.includes(unit)) return "unitOfSale must be EACH, PER_HEAD, PER_KG or PER_CRATE";
  if (unit === "PER_HEAD") {
    if (categoryId === null || categoryId === undefined) return "a per-head price needs a livestock category";
    const livestock = await isLivestockCategory(prisma, categoryId);
    if (!livestock) return "per-head pricing is only allowed for livestock categories";
  }
  return null;
}

module.exports = { UNITS, checkUnit, isLivestockCategory };
