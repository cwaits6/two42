import { createElement as h, Fragment, type ReactNode } from "react";

// Stands in for the Select in component tests: each option is a plain button
// that reports its value, as picking it in the Base UI popup does. Picking the
// option already selected reports it again, which the popup also does.
const passthrough = ({ children }: { children?: ReactNode }) => children;

export const Select = ({
  items,
  disabled,
  onValueChange,
}: {
  items: { value: string; label: string }[];
  disabled?: boolean;
  onValueChange: (value: string) => void;
}) =>
  h(
    Fragment,
    null,
    items.map((item) =>
      h("button", { key: item.value, type: "button", disabled, onClick: () => onValueChange(item.value) }, item.label),
    ),
  );
export const SelectContent = () => null;
export const SelectGroup = passthrough;
export const SelectItem = passthrough;
export const SelectLabel = passthrough;
export const SelectTrigger = passthrough;
export const SelectValue = () => null;
