// Zimbabwe's ten provinces. Districts are not listed here: admins add them from the official ZIMSTAT list,
// because the sources differ on how many districts there are.
const PROVINCES = [
  "Bulawayo",
  "Harare",
  "Manicaland",
  "Mashonaland Central",
  "Mashonaland East",
  "Mashonaland West",
  "Masvingo",
  "Matabeleland North",
  "Matabeleland South",
  "Midlands",
];

// A listing's province must be one of the ten. Its district must be one the admin has added for that province.
async function checkLocation(prisma, province, district) {
  if (province === undefined && district === undefined) return null;
  if (!PROVINCES.includes(province)) {
    return `province must be one of: ${PROVINCES.join(", ")}`;
  }
  const found = await prisma.district.findUnique({ where: { province_name: { province, name: district } } });
  if (!found) return `district "${district}" is not in the list for ${province}; ask an admin to add it`;
  return null;
}

module.exports = { PROVINCES, checkLocation };
