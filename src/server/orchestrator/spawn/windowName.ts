export function makeWindowName(projectShortName: string, runtimeId: string, shortId: string): string {
  const sanitize = (value: string) => value.toLowerCase().replace(/[^a-z0-9-]/g, "-");
  return `${sanitize(projectShortName)}-${sanitize(runtimeId)}-${sanitize(shortId)}`;
}

export function slugify(value: string): string {
  const slug = value.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/(^-|-$)/g, "");
  return slug || "project";
}
