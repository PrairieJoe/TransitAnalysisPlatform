import { describe, expect, it } from 'vitest';
import { buildODDemandMapModel } from '../../src/core/od-demand-view';

const rows = [
  { originStationId: 'A', destinationStationId: 'B', originStationName: '시청', destinationStationName: '시장', totalBoardings: 100, dailyAverage: 100, rank: 1, originLatitude: 34.75, originLongitude: 127.73, destinationLatitude: 34.76, destinationLongitude: 127.75, mapAvailable: true },
  { originStationId: 'B', destinationStationId: 'A', originStationName: '시장', destinationStationName: '시청', totalBoardings: 60, dailyAverage: 60, rank: 2, originLatitude: 34.76, originLongitude: 127.75, destinationLatitude: 34.75, destinationLongitude: 127.73, mapAvailable: true },
  { originStationId: 'A', destinationStationId: 'UNKNOWN', originStationName: '시청', destinationStationName: '사전 미등록', totalBoardings: 10, dailyAverage: 10, rank: 3, originLatitude: 34.75, originLongitude: 127.73, destinationLatitude: null, destinationLongitude: null, mapAvailable: false }
];

describe('OD demand map model', () => {
  it('keeps all mappable flows and creates curved paths with arrowheads', () => {
    const model = buildODDemandMapModel(rows);
    expect(model.flows).toHaveLength(2);
    expect(model.flows[0].points.length).toBeGreaterThan(2);
    expect(model.flows[0].arrowhead).toHaveLength(3);
    expect(model.endpoints).toHaveLength(2);
  });

  it('separates reverse flows onto opposite curve sides and highlights selection', () => {
    const model = buildODDemandMapModel(rows, 'A→B');
    const forward = model.flows.find((flow) => flow.key === 'A→B')!;
    const reverse = model.flows.find((flow) => flow.key === 'B→A')!;
    expect(forward.color).not.toBe(reverse.color);
    expect(forward.width).toBeGreaterThan(reverse.width);
    expect(forward.points[12].latitude).not.toBe(reverse.points[12].latitude);
  });
});
