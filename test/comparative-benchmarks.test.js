const { expect } = require('chai');
const { stats, difference, validate, csv, receiptGas } = require('../scripts/benchmarks/comparative/common');

describe('Comparative benchmark measurement rules', function () {
  it('uses an arithmetic median for even samples and population deviation', function () {
    const result = stats([4, 1, 3, 2]);
    expect(result.median).to.equal(2.5);
    expect(result.standardDeviation).to.equal(Math.sqrt(1.25));
    expect(result.count).to.equal(4);
  });
  it('does not invent overhead for zero baselines or unrelated operation semantics', function () {
    expect(difference(0, 10, true)).to.equal(null);
    expect(difference(10, 20, false)).to.equal(null);
    expect(difference(10, 20, true)).to.deep.equal({ absolute: 10, percentage: 100, direction: 'increase' });
    expect(difference(20, 10, true).direction).to.equal('decrease');
  });
  it('rejects missing samples and non-finite nested measurements', function () {
    expect(() => stats([])).to.throw('No samples');
    expect(() => validate({ metrics: [NaN] })).to.throw('Non-finite');
    expect(() => stats([1, Infinity])).to.throw('Non-finite');
  });
  it('extracts gas only from successful receipts with valid gasUsed', function () {
    expect(receiptGas({ status: 1, gasUsed: 21000n })).to.equal(21000);
    expect(() => receiptGas({ status: 0, gasUsed: 21000n })).to.throw('unsuccessful');
    expect(() => receiptGas({ status: 1, gasUsed: 0n })).to.throw('invalid gasUsed');
  });
  it('escapes CSV fields containing commas, quotes and newlines', function () {
    expect(csv(['name'], [['a,"b"\nc']])).to.equal('"name"\n"a,""b""\nc"\n');
  });
});
