export type AddressFields = {
  name: string;
  phone: string;
  line1: string;
  line2: string;
  city: string;
  postalCode: string;
  country: string;
};

export const emptyAddress: AddressFields = {
  name: "",
  phone: "",
  line1: "",
  line2: "",
  city: "",
  postalCode: "",
  country: "Zimbabwe",
};

// Checks the same fields the API requires, and returns one message per problem
export function checkAddress(a: AddressFields): string[] {
  const problems: string[] = [];
  const required: [keyof AddressFields, string][] = [
    ["name", "Full name"],
    ["phone", "Phone"],
    ["line1", "Address line 1"],
    ["city", "City"],
    ["postalCode", "Postal code"],
    ["country", "Country"],
  ];
  for (const [key, label] of required) {
    if (!a[key].trim()) problems.push(`${label} is required`);
  }
  if (a.name.trim().length > 120) problems.push("Full name is too long");
  if (a.phone.trim().length > 30) problems.push("Phone is too long");
  if (a.line2.trim().length > 200) problems.push("Address line 2 is too long");
  return problems;
}
