import { RosterStatus, CAP_MULTIPLIER_PCT } from "./rules.js";

export class Contract {
  constructor(
    private _salaryCents: number,
    private _status: RosterStatus = RosterStatus.ACTIVE,
  ) {}

  get salaryCents(): number {
    return this._salaryCents;
  }

  get status(): RosterStatus {
    return this._status;
  }

  calcCapHit(): number {
    return Math.floor(
      this._salaryCents * CAP_MULTIPLIER_PCT[this._status] / 100,
    );
  }
}
