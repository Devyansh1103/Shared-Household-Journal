import { describe, expect, it } from "vitest";
import {
  amountsOn,
  dateOn,
  extractReceipt,
  readAmount,
  timeOn,
  type OcrLine,
  type ReceiptExtraction,
} from "./extract";

const INR = { currency: "INR", exponent: 2, today: "2026-11-14" };

function lines(text: string, confidence: number | null = 92): OcrLine[] {
  return text
    .trim()
    .split("\n")
    .map((line) => ({ text: line.trim(), confidence }));
}

const codes = (r: ReceiptExtraction) => r.warnings.map((w) => w.code);
const minor = (n: string) => BigInt(n);

describe("readAmount", () => {
  it.each([
    ["450", 2, "45000"],
    ["450.00", 2, "45000"],
    ["45.5", 2, "4550"],
    ["1,250.50", 2, "125050"],
    ["1,25,000.00", 2, "12500000"],
    ["12,34,567", 2, "1234567" + "00"],
    ["1,250", 2, "125000"],
    ["12,50", 2, "1250"],
    ["1.234,56", 2, "123456"],
    ["1.250.000", 2, "125000000"],
    ["-20.00", 2, "-2000"],
    ["(0.40)", 2, "-40"],
    ["1250", 0, "1250"],
    ["1.250", 3, "1250"],
  ])("%s at %i decimals is %s minor units", (token, exponent, expected) => {
    expect(readAmount(token, exponent)).toBe(minor(expected));
  });

  it.each([
    ["1.250", 2], // thousands or 1.25? ambiguous
    ["12.345", 2], // more decimals than INR has
    ["12.50", 0], // JPY has none
    ["9876543210", 2], // a phone number
    ["1,2,3", 2],
    ["12,", 2],
    ["abc", 2],
    ["1.2.50", 2],
  ])("%s at %i decimals isn't read as an amount", (token, exponent) => {
    expect(readAmount(token, exponent)).toBeNull();
  });

  it("skips dates, times, percentages, codes and currency signs", () => {
    expect(amountsOn("CGST @ 2.5% 11.25", 2)).toEqual([minor("1125")]);
    expect(amountsOn("12/11/2026 18:42 Total 450.00", 2)).toEqual([
      minor("45000"),
    ]);
    expect(amountsOn("Rs.450.00", 2)).toEqual([minor("45000")]);
    expect(amountsOn("₹1,250.50", 2)).toEqual([minor("125050")]);
    expect(amountsOn("7UP 500ML A4 SKU-12 30.00", 2)).toEqual([minor("3000")]);
  });
});

describe("dates and times", () => {
  it("reads day-first (en-IN), and says when it can't be sure", () => {
    expect(dateOn("Date: 13/11/2026")).toEqual({
      iso: "2026-11-13",
      ambiguous: false,
    });
    expect(dateOn("05/11/2026")).toEqual({
      iso: "2026-11-05",
      ambiguous: true,
    });
    expect(dateOn("11/30/2026")).toEqual({
      iso: "2026-11-30",
      ambiguous: false,
    });
    expect(dateOn("07-07-26")).toEqual({ iso: "2026-07-07", ambiguous: false });
    expect(dateOn("2026-11-12 10:30")).toEqual({
      iso: "2026-11-12",
      ambiguous: false,
    });
    expect(dateOn("12 Nov 2026")).toEqual({
      iso: "2026-11-12",
      ambiguous: false,
    });
    expect(dateOn("Nov 3, 2026")).toEqual({
      iso: "2026-11-03",
      ambiguous: false,
    });
    expect(dateOn("1st December '26")).toEqual({
      iso: "2026-12-01",
      ambiguous: false,
    });
  });

  it("refuses dates that don't exist", () => {
    expect(dateOn("31/02/2026")).toBeNull();
    expect(dateOn("45/13/2026")).toBeNull();
    expect(dateOn("No date here 450.00")).toBeNull();
  });

  it("reads times as 24-hour", () => {
    expect(timeOn("Time 18:42")).toBe("18:42");
    expect(timeOn("06:05 PM")).toBe("18:05");
    expect(timeOn("12:15 am")).toBe("00:15");
    expect(timeOn("Total 12.50")).toBeNull();
  });
});

describe("extractReceipt", () => {
  it("reads a supermarket receipt", () => {
    const result = extractReceipt(
      lines(`
        FRESH MART SUPERMARKET
        12 MG Road, Bengaluru 560001
        GSTIN: 29ABCDE1234F1Z5
        Tax Invoice
        Bill No: FM-20481 Date: 12/11/2026 18:42
        Milk 1L 2 x 45.00 90.00
        Brown Bread 40.00
        Eggs (12) 84.00
        Sub Total 214.00
        CGST @ 2.5% 5.35
        SGST @ 2.5% 5.35
        Discount -4.70
        Grand Total 220.00
        Paid by UPI
        Thank you! Visit again
      `),
      INR,
    );
    expect(result.merchant?.value).toBe("FRESH MART SUPERMARKET");
    expect(result.date?.value).toBe("2026-11-12");
    expect(result.time?.value).toBe("18:42");
    expect(result.subtotal?.value).toBe(minor("21400"));
    expect(result.taxes.map((t) => t.value)).toEqual([
      minor("535"),
      minor("535"),
    ]);
    expect(result.discount?.value).toBe(minor("470"));
    expect(result.total?.value).toBe(minor("22000"));
    expect(result.paymentMethod?.value).toBe("upi");
    expect(result.invoiceNumber?.value).toBe("FM-20481");
    expect(result.currency).toBeNull();
    expect(result.items).toEqual([
      {
        name: "Milk 1L",
        quantity: "2",
        unitMinor: minor("4500"),
        totalMinor: minor("9000"),
        confidence: "ok",
      },
      {
        name: "Brown Bread",
        quantity: null,
        unitMinor: null,
        totalMinor: minor("4000"),
        confidence: "ok",
      },
      {
        name: "Eggs",
        quantity: null,
        unitMinor: null,
        totalMinor: minor("8400"),
        confidence: "ok",
      },
    ]);
    // 214.00 + 10.70 − 4.70 = 220.00, and the items make the subtotal. Only
    // the date needs a look: 12/11 could be 12 November or 11 December.
    expect(codes(result)).toEqual(["date_ambiguous"]);
  });

  it("reads a restaurant bill with service charge and rounding", () => {
    const result = extractReceipt(
      lines(`
        Spice Garden Restaurant
        Table 4 Covers 2
        Date 13 Nov 2026 Time 21:05
        Paneer Tikka 1 280.00 280.00
        Dal Makhani 1 240.00 240.00
        Butter Naan 4 45.00 180.00
        Sub Total 700.00
        Service Charge 5% 35.00
        CGST 9% 66.15
        SGST 9% 66.15
        Round Off -0.30
        Net Payable ₹867.00
        Card: VISA **** 4421
      `),
      INR,
    );
    expect(result.merchant?.value).toBe("Spice Garden Restaurant");
    expect(result.date?.value).toBe("2026-11-13");
    expect(result.time?.value).toBe("21:05");
    expect(result.total?.value).toBe(minor("86700"));
    expect(result.currency?.value).toBe("INR");
    expect(result.charges.map((c) => c.value)).toEqual([
      minor("3500"),
      minor("-30"),
    ]);
    expect(result.paymentMethod?.value).toBe("card");
    expect(
      result.items.map((i) => [i.name, i.quantity, i.unitMinor, i.totalMinor]),
    ).toEqual([
      ["Paneer Tikka", "1", minor("28000"), minor("28000")],
      ["Dal Makhani", "1", minor("24000"), minor("24000")],
      ["Butter Naan", "4", minor("4500"), minor("18000")],
    ]);
    expect(codes(result)).toEqual([]);
  });

  it("flags figures that don't add up, and tells rounding apart", () => {
    const differ = extractReceipt(
      lines("Corner Store\nSubtotal 100.00\nGST 18.00\nTotal 128.00"),
      INR,
    );
    expect(differ.warnings).toContainEqual({
      code: "totals_differ",
      expectedMinor: minor("11800"),
      totalMinor: minor("12800"),
    });
    const rounding = extractReceipt(
      lines("Corner Store\nSubtotal 100.00\nGST 18.40\nTotal 118.00"),
      INR,
    );
    expect(codes(rounding)).toContain("totals_rounding");
    // Prices that include tax: subtotal equals total.
    const inclusive = extractReceipt(
      lines("Corner Store\nSubtotal 118.00\nGST included 18.00\nTotal 118.00"),
      INR,
    );
    expect(codes(inclusive)).not.toContain("totals_differ");
    expect(codes(inclusive)).not.toContain("totals_rounding");
  });

  it("flags items that don't add up to the subtotal", () => {
    const result = extractReceipt(
      lines(
        "Kirana Shop\nRice 5kg 320.00\nOil 1L 150.00\nSubtotal 520.00\nTotal 520.00",
      ),
      INR,
    );
    expect(result.warnings).toContainEqual({
      code: "items_differ",
      itemsMinor: minor("47000"),
      againstMinor: minor("52000"),
    });
  });

  it("leaves out what isn't there, and says so", () => {
    const result = extractReceipt(
      lines("Thank you\n2 x 30.00\n12/11/2026"),
      INR,
    );
    expect(result.merchant).toBeNull();
    expect(result.total).toBeNull();
    expect(codes(result)).toEqual(
      expect.arrayContaining(["no_total", "no_merchant", "date_ambiguous"]),
    );
    expect(codes(result)).not.toContain("no_date");

    const noDate = extractReceipt(
      lines("Chai Point\nMasala Chai 30.00\nTotal 30.00"),
      INR,
    );
    expect(noDate.date).toBeNull();
    expect(codes(noDate)).toEqual(["no_date"]);
    expect(noDate.total?.value).toBe(minor("3000"));
  });

  it("reads nothing from nothing", () => {
    expect(codes(extractReceipt([], INR))).toEqual(["nothing_read"]);
    expect(codes(extractReceipt(lines("   \n  "), INR))).toEqual([
      "nothing_read",
    ]);
  });

  it("notices another currency, and ignores codes it doesn't know", () => {
    const usd = extractReceipt(
      lines("Airport Cafe\nLatte 4.50\nTotal USD 4.50\n12/11/2026"),
      INR,
    );
    expect(usd.currency?.value).toBe("USD");
    expect(usd.warnings).toContainEqual({
      code: "other_currency",
      currency: "USD",
    });

    const unknown = extractReceipt(lines("Shop XYZ\nTotal XYZ 10.00"), INR);
    expect(unknown.currency).toBeNull();
    expect(codes(unknown)).not.toContain("other_currency");

    const both = extractReceipt(
      lines("Duty Free\nTotal INR 900.00\nEUR 10.00"),
      INR,
    );
    expect(both.warnings).toContainEqual({
      code: "several_currencies",
      currencies: ["EUR", "INR"],
    });
    expect(codes(both)).not.toContain("other_currency");
  });

  it("flags hard-to-read values by name, and says nothing when the engine gives no confidence", () => {
    const blurry = extractReceipt(
      [
        { text: "Sunrise Bakery", confidence: 41 },
        { text: "Date 12/11/2026", confidence: 95 },
        { text: "Total 150.00", confidence: 55 },
      ],
      INR,
    );
    expect(blurry.merchant?.confidence).toBe("low");
    expect(blurry.total?.confidence).toBe("low");
    expect(blurry.date?.confidence).toBe("ok");
    expect(blurry.warnings).toContainEqual({
      code: "low_confidence",
      fields: ["merchant", "total"],
    });

    const unknown = extractReceipt(
      lines("Sunrise Bakery\nTotal 150.00", null),
      INR,
    );
    expect(unknown.total?.confidence).toBe("unknown");
    expect(codes(unknown)).not.toContain("low_confidence");
  });

  it("says when hard-to-read lines became nothing, so a missing tax isn't silent", () => {
    // What the engine made of two GST lines on a degraded (JPEG) copy.
    const result = extractReceipt(
      [
        { text: "FRESH MART SUPERMARKET", confidence: 95 },
        { text: "Sub Total         130.00", confidence: 95 },
        { text: "CGS: 5%           3.25", confidence: 39 },
        { text: "SESH: 5%           3.25", confidence: 41 },
        { text: "TOTAL             136.50", confidence: 95 },
      ],
      INR,
    );
    expect(result.taxes).toEqual([]);
    expect(result.warnings).toContainEqual({ code: "unclear_lines", count: 2 });
    expect(codes(result)).toContain("totals_differ");
    // Clear lines don't trigger it.
    expect(
      codes(extractReceipt(lines("Shop\nTotal 10.00"), INR)),
    ).not.toContain("unclear_lines");
  });

  it("checks the date against the household's today", () => {
    expect(
      codes(extractReceipt(lines("Shop\nDate 20/11/2026\nTotal 10.00"), INR)),
    ).toContain("date_in_future");
    expect(
      codes(extractReceipt(lines("Shop\nDate 20/10/2024\nTotal 10.00"), INR)),
    ).toContain("date_old");
  });

  it("takes the grand total over earlier totals, and never the cash handed over", () => {
    const result = extractReceipt(
      lines(`
        Metro Mart
        Total Qty 3
        Total 450.00
        Amount Payable 450.00
        Cash 500.00
        Change 50.00
        Amount Paid 500.00
      `),
      INR,
    );
    expect(result.total?.value).toBe(minor("45000"));
    expect(result.paymentMethod?.value).toBe("cash");
  });

  it("doesn't take an address or a phone number for an item", () => {
    const result = extractReceipt(
      lines(`
        Green Grocers
        45 Park Street Kolkata 700016
        Ph 9876543210
        Tomatoes 1kg 60.00
        Total 60.00
      `),
      INR,
    );
    expect(result.items.map((i) => i.name)).toEqual(["Tomatoes 1kg"]);
  });

  it("works for currencies without decimals", () => {
    const result = extractReceipt(
      lines("Tokyo Ramen\nRamen 1,200\nTotal 1,200"),
      {
        currency: "JPY",
        exponent: 0,
        today: "2026-11-14",
      },
    );
    expect(result.total?.value).toBe(minor("1200"));
  });
});
