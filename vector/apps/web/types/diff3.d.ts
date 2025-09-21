declare module 'diff3' {
  interface MergeOk {
    ok: string[]
  }

  interface MergeConflict {
    conflict: {
      a?: string[]
      o?: string[]
      b?: string[]
    }
  }

  type MergePart = MergeOk | MergeConflict

  function diff3Merge(a: string[], o: string[], b: string[]): MergePart[]

  export = diff3Merge
}
