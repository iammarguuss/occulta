declare class UldaSign {
  constructor(cfg?: any);
  New(): Promise<any>;
  stepUp(origin: any): Promise<any>;
  sign(origin: any): Promise<any>;
  verify(sigA: any, sigB: any): Promise<boolean>;
}
export default UldaSign;
