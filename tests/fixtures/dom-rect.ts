/**
 * Gives one element a fixed rect.
 *
 * happy-dom measures every element as zero, so anything that reads geometry
 * from the DOM — the splitter's drag arithmetic especially — needs the numbers
 * supplied. Real geometry is covered against a browser instead.
 */
export type StubRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export function stubRect(element: Element, rect: StubRect): void {
  element.getBoundingClientRect = () =>
    ({
      ...rect,
      x: rect.left,
      y: rect.top,
      right: rect.left + rect.width,
      bottom: rect.top + rect.height,
      toJSON: () => rect,
    }) as DOMRect;
}
