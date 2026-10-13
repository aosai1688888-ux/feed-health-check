#!/usr/bin/env python3
"""Generate an isolated Paddle Sandbox-only checkout candidate; never overwrite production."""
import argparse
import json
import os
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--output",type=Path,required=True)
    args=ap.parse_args()
    token=os.getenv("FEEDHEALTH_PADDLE_SANDBOX_CLIENT_TOKEN","")
    price=os.getenv("FEEDHEALTH_PADDLE_SANDBOX_PRICE_ID","")
    product=os.getenv("FEEDHEALTH_PADDLE_SANDBOX_PRODUCT_ID","")
    if not re.fullmatch(r"test_[A-Za-z0-9_]{12,160}",token):
        raise SystemExit("HOLD: missing/invalid Sandbox public client-side token")
    if not re.fullmatch(r"pri_[a-z0-9]{20,40}",price):
        raise SystemExit("HOLD: missing/invalid Sandbox price ID")
    if not re.fullmatch(r"pro_[a-z0-9]{20,40}",product):
        raise SystemExit("HOLD: missing/invalid Sandbox product ID")
    output=args.output.resolve()
    if ROOT in output.parents or output==ROOT:
        raise SystemExit("HOLD: never overwrite source production config")
    base=json.loads((ROOT/"checkout-config.v1.json").read_text())
    if not (base["enabled"] is False and base["provider"]=="UNBOUND"):
        raise SystemExit("HOLD: original production config not fail-closed")
    base.update({
        "status":"SANDBOX_TEST_ONLY_NOT_PRODUCTION",
        "provider":"PADDLE","enabled":True,
        "environment":"sandbox","sandbox_test_purchase_only":True,
        "checkout_url":None,
        "paddle":{"client_side_token":token,"price_id":price,"product_id":product},
        "fulfillment_status":"NOT_VERIFIED","production_authorization":"DENIED"
    })
    output.parent.mkdir(parents=True,exist_ok=True)
    fd=os.open(output,os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600)
    with os.fdopen(fd,"w") as f:
        json.dump(base,f,indent=2)
        f.write("\n")
    print("FEEDHEALTH_PADDLE_SANDBOX_CONFIG=CREATED_UNDEPLOYED")
    print("PRODUCTION_CHECKOUT_UNCHANGED=TRUE")
    print("WEBHOOK_AND_AI_DELIVERY_UNVERIFIED=TRUE")
if __name__=="__main__":
    main()
