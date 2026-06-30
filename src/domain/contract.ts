export class Contract {
  constructor(private _salaryCents: number) {}

  get salaryCents(): number {
    return this._salaryCents;
  }
}
