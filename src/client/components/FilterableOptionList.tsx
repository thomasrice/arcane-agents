export interface FilterableOption {
  id: string;
  label: string;
  subLabel: string;
}

interface FilterableOptionListProps {
  className: string;
  itemClassName: string;
  emptyText: string;
  options: FilterableOption[];
  activeIndex: number;
  onHoverIndex: (index: number) => void;
  onSelectIndex: (index: number) => void;
}

// Presentational active-index list: label + sub-label rows with a highlighted cursor,
// hover-to-focus, and click-to-run. Pairs with useFilterableList for keyboard control.
export function FilterableOptionList({
  className,
  itemClassName,
  emptyText,
  options,
  activeIndex,
  onHoverIndex,
  onSelectIndex
}: FilterableOptionListProps): JSX.Element {
  return (
    <div className={className}>
      {options.length === 0 ? <div className="palette-empty">{emptyText}</div> : null}

      {options.map((option, index) => (
        <button
          key={option.id}
          className={`${itemClassName} ${index === activeIndex ? "active" : ""}`}
          onMouseEnter={() => onHoverIndex(index)}
          onClick={() => onSelectIndex(index)}
          type="button"
        >
          <span>{option.label}</span>
          <small>{option.subLabel}</small>
        </button>
      ))}
    </div>
  );
}
