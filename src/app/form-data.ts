// Form fields are untrusted: a field that isn't text (a file) counts as absent.

export function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

export function texts(formData: FormData, name: string): string[] {
  return formData.getAll(name).filter((v): v is string => typeof v === "string");
}
