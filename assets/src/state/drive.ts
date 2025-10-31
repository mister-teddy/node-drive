import { atomFamily, atomWithRefresh } from "jotai/utils";
import { atom, useSetAtom } from "jotai";
import { fetchJsonWithError } from "../utils";
import { LsDirData } from "../type";
import { useLocation } from "react-router-dom";

export const lsdirDataAtom = atomFamily((path: string) =>
  atomWithRefresh(async () => {
    const data = await fetchJsonWithError<LsDirData>(
      `/api/${path}`,
      `Failed to fetch data`
    );
    return data;
  })
);

export const lsdirAtom = atomFamily((path: string) =>
  atom(async (get) => {
    const data = await get(lsdirDataAtom(path));
    return data.paths;
  })
);

export const metadataAtom = atomFamily((path: string) =>
  atom(async (get) => {
    const data = await get(lsdirDataAtom(path));
    return {
      href: data.href,
      uri_prefix: data.uri_prefix,
      kind: data.kind,
      dir_exists: data.dir_exists,
    };
  })
);

export function useRefreshData() {
  const location = useLocation();
  const path = location.pathname;
  const refresh = useSetAtom(lsdirDataAtom(path));

  return refresh;
}
