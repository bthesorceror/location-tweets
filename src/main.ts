import axios from 'axios';
import * as commander from 'commander';
import * as fs from 'fs';
import * as HtmlEntities from 'html-entities';
import { InfluxDB } from 'influx';
import * as path from 'path';
import * as Sentiment from 'sentiment';
import * as Twit from 'twit';

interface IOptions {
  url: string;
  database: string;
  config: string;
  location: string;
}

interface IConfig {
  consumer_key: string;
  consumer_secret: string;
  access_token: string;
  access_token_secret: string;
}

interface IGeoLocation {
  lat: number;
  lng: number;
}

interface IBounds {
  northeast: IGeoLocation;
  southwest: IGeoLocation;
}

interface IGeocodedLocationResult {
  formatted_address: string;
  geometry: {
    bounds: IBounds;
  };
}

interface IGeocodedLocation {
  results: IGeocodedLocationResult[];
  status: string;
}

const geocodeToTwitterLocation = (result: IGeocodedLocationResult): string => {
  const {
    geometry: { bounds },
  } = result;

  return [
    bounds.southwest.lng,
    bounds.southwest.lat,
    bounds.northeast.lng,
    bounds.northeast.lat,
  ].join(',');
};

interface IParams extends Twit.Params {
  locations: string;
}

const createTwitterChannels = (
  location: string,
  config: IConfig
): Twit.Stream => {
  const client = new Twit(config);
  const params: IParams = { locations: location };

  return client.stream('statuses/filter', params);
};

const parseConfig = (filepath: string): IConfig => {
  const contents: string = fs.readFileSync(filepath, { encoding: 'utf8' });
  const results: IConfig = JSON.parse(contents);

  return results;
};

const createInfluxClient = (url: string, database: string): InfluxDB => {
  return new InfluxDB(`${url}/${database}`);
};

const geocodeLocation = async (
  address: string
): Promise<IGeocodedLocationResult> => {
  const url = 'https://maps.googleapis.com/maps/api/geocode/json';
  const results = await axios.get<IGeocodedLocation>(url, {
    params: { address, sensor: false },
  });

  return results.data.results[0];
};

const start = async () => {
  commander
    .name('location-tweets')
    .version('1.0.0')
    .option(
      '-u, --url <url>',
      'url to influx instance',
      'http://localhost:8086'
    )
    .option(
      '-d, --database <database>',
      'influxdb database to store data',
      'tweets'
    )
    .option(
      '-c, --config <path>',
      'path to twitter config file',
      path.join(process.env.HOME || '', '.tweets.json')
    )
    .option(
      '-l, --location <city,state>',
      'location that you want to monitor tweets from',
      'San Francisco, CA'
    )
    .parse(process.argv);

  const { url, database, config, location } = commander.opts();

  const twitterConfig: IConfig = parseConfig(config);
  const influxClient: InfluxDB = createInfluxClient(url, database);
  const geocodedLocation: IGeocodedLocationResult = await geocodeLocation(
    location
  );
  const twitterLocation = geocodeToTwitterLocation(geocodedLocation);
  const stream = createTwitterChannels(twitterLocation, twitterConfig);

  const decoder = new HtmlEntities.AllHtmlEntities();
  const analyzer = new Sentiment();

  stream.on('tweet', (tweet: Twit.Twitter.Status) => {
    const text = decoder.decode(tweet.text);
    const analysis = analyzer.analyze(text);

    const { score, comparative } = analysis;
    const fields = { score, comparative, text, charCount: text.length };

    influxClient.writeMeasurement('sentiment', [
      {
        fields,
        tags: {
          location,
        },
      },
    ]);
  });
};

module.exports = start;
