// Attributes each category asks for. A category is matched by its name and its level in the tree.
// required: the listing is refused without it. type: text, number, date, or a fixed list of choices.
const RULES = {
  livestock: [
    { name: "breed", required: true, type: "text" },
    { name: "sex", required: true, type: "choice", choices: ["male", "female", "castrated"] },
    { name: "ageMonths", required: true, type: "number" },
    { name: "weightKg", required: false, type: "number" },
  ],
  produce: [
    { name: "harvestDate", required: true, type: "date" },
    { name: "availability", required: false, type: "text" },
  ],
  equipment: [
    { name: "make", required: true, type: "text" },
    { name: "model", required: true, type: "text" },
    { name: "condition", required: true, type: "choice", choices: ["new", "used"] },
    { name: "hoursUsed", required: false, type: "number", onlyIf: { name: "condition", value: "used" } },
  ],
};

// Works out which rule set applies to a category, by walking up to its top-level branch.
// Returns "livestock", "produce", "equipment", or null for categories with no rules.
async function ruleSetFor(prisma, categoryId) {
  let current = await prisma.category.findUnique({ where: { id: categoryId } });
  while (current) {
    if (current.level === 1 && current.name === "Agriculture") {
      // Find which branch under Agriculture this category belongs to
      let branch = current;
      let node = await prisma.category.findUnique({ where: { id: categoryId } });
      while (node && node.level > 2) {
        node = await prisma.category.findUnique({ where: { id: node.parentId } });
      }
      if (!node) return null;
      if (node.name === "Livestock") return "livestock";
      if (node.name === "Farm produce") return "produce";
      if (node.name === "Equipment") return "equipment";
      return null;
    }
    if (current.parentId === null) return null;
    current = await prisma.category.findUnique({ where: { id: current.parentId } });
  }
  return null;
}

// Checks a set of attribute values against the rules for a category. Returns an error, or null if valid.
function checkAttributes(ruleSet, values) {
  if (!ruleSet) return null;
  const rules = RULES[ruleSet];
  const given = values || {};
  for (const rule of rules) {
    if (rule.onlyIf && given[rule.onlyIf.name] !== rule.onlyIf.value) continue;
    const value = given[rule.name];
    if (rule.required && (value === undefined || value === null || String(value).trim() === "")) {
      return `${rule.name} is required for this category`;
    }
    if (value === undefined || value === null) continue;
    if (rule.type === "number" && (typeof value !== "number" || Number.isNaN(value) || value < 0)) {
      return `${rule.name} must be a number of 0 or more`;
    }
    if (rule.type === "choice" && !rule.choices.includes(value)) {
      return `${rule.name} must be one of: ${rule.choices.join(", ")}`;
    }
    if (rule.type === "date" && Number.isNaN(Date.parse(value))) {
      return `${rule.name} must be a date`;
    }
  }
  return null;
}

module.exports = { RULES, ruleSetFor, checkAttributes };
