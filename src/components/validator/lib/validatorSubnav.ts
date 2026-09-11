export type ValidatorSubnavSection = "test" | "statistics";

export function subnavAriaCurrent(
  active: ValidatorSubnavSection,
  link: ValidatorSubnavSection,
): "page" | undefined {
  return active === link ? "page" : undefined;
}
