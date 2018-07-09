import Network from './Network';
import Command from './Command';
import ReportContextMapper from './mappers/ReportContextMapper';
import OptionsMapper from './mappers/OptionsMapper';
import RowEventMapper from './mappers/RowEventMapper';
import ProjectionMapper from './mappers/ProjectionMapper';
import ProtoLoader from './core/ProtoLoader';
import Logger from 'common/Logger';
import GenericJSONCommandPromise from 'common/promises/GenericJSONCommandPromise';
import Rx from 'rxjs/Rx';

export default class Client {
  static Current;
  constructor(url, {clientVersion, authenticationType = 'compatableVersionEvenlyDistributed'}) {
    this.url = url;
    this.clientVersion = clientVersion;
    this.authenticationType = authenticationType;
    this.network = new Network(this.url);
    this.connection.connectionObservable.subscribe(
      res => {
        this.onConnectionEstablished(res);
      }
    );
  }

  static setCurrent(client){
    Client.Current = client;
  }

  get connection(){
    return this.network.connection;
  }

  setUri(uri){
    this.connection.setUri(uri);
  }

  connect(autoReconnect){
    return this.network.connect(autoReconnect);
  }

  async onConnectionEstablished(isConnected){
    if (isConnected){
      const commandExecutedPromise = new GenericJSONCommandPromise();
      Logger.debug(`Authenticating : ${this.clientVersion}`);
      this.authenticate(this.authenticationType, this.clientVersion, commandExecutedPromise);
      try {
        await commandExecutedPromise.timeoutWithError(5000, new Error('Could not authenticate in 5 seconds'));
        Logger.info(`Successfully authenticated client version ${this.clientVersion}`);
        return;
      } catch (negativeAuthenticationResult){
        try {
          const alternativeObj = JSON.parse(negativeAuthenticationResult);
          const {alternative, message} = alternativeObj;
          if (!alternative){
            Logger.error(message);
          } else {
            Logger.info(message);
            const parts = alternative.split(',');
            const wsPart = parts.find(p => p.startsWith('ws'));
            if (wsPart){
              this.setUri(wsPart);
            }
          }
        } catch (error){
          Logger.info(`Couldn't authenticate and couldnt find alternative url will keep retrying ${error}`);
        }
      }
      const disconnectedPromise = new GenericJSONCommandPromise();
      Logger.info('Disconnecting connection');
      this.disconnect(disconnectedPromise, false);
      const result = await disconnectedPromise;
      Logger.info(`Connection disconnected ${result} attempting reconnection`);
      this.connection.connect(true);
    }
  }

  get connected(){
    return this.network.connected;
  }

  authenticate (type, clientVersion, eventhandlers) {
    const authenticateCommand = ProtoLoader.Dto.AuthenticateCommandDto.create({type, clientVersion});
    this.sendCommand('authenticate', authenticateCommand, false, eventhandlers);
  }

  disconnect(eventHandlers, forceClosed) {
    this.network.disconnect(eventHandlers, forceClosed);
  }

  unsubscribe = function (commandId, eventHandlers) {
    const unsubscribeCommand = ProtoLoader.Dto.UnsubscribeCommandDto.create({subscriptionId: commandId});
    this.network.connection.removeOpenCommand(commandId);
    return this.sendCommand('unsubscribe', unsubscribeCommand, false, eventHandlers);
  };

  executeSql = function (query, permanent, dataSink) {
    const sqlCommand = ProtoLoader.Dto.ExecuteSqlCommandDto.create({query, permanent});
    return this.sendCommand('executeSql', sqlCommand, true, dataSink);
  };

  subscribe = function (operatorName, options, dataSink, output, projection) {
    const optionsDto = OptionsMapper.toDto(options);
    const payload = {operatorName, outputName: output || 'out', options: optionsDto};
    const error = ProtoLoader.Dto.SubscribeCommandDto.verify(payload);
    if (error){
      throw Error(error);
    }
    const subscribeCommand = ProtoLoader.Dto.SubscribeCommandDto.create(payload);
    if (projection !== undefined) {
      subscribeCommand.setProjection(ProjectionMapper.toDto(projection));
    }
    return this.sendCommand('subscribe', subscribeCommand, true, dataSink, 200);
  };

  subscribeToDataSource = function (dataSourceName, options, dataSink, output, projection) {
    return this.subscribe(`/datasources/${dataSourceName}/default`, options, dataSink, output, projection);
  };

  subscribeToReport = function (reportContext, options, dataSink) {
    const reportContextDto = ReportContextMapper.toDto(reportContext);
    const optionsDto = OptionsMapper.toDto(options);

    const subscribeReportCommand = ProtoLoader.Dto.SubscribeReportCommandDto.create({
      context: reportContextDto,
      options: optionsDto
    });

    return this.sendCommand('subscribeReport', subscribeReportCommand, true, dataSink);
  };

  subscribeToDimension = function (dimension, reportContext, options, dataSink) {
    const context = ReportContextMapper.toDto(reportContext);
    const optionsDto = OptionsMapper.toDto(options);

    const subscribeReportCommand = ProtoLoader.Dto.SubscribeDimensionCommandDto.create({
      dimension,
      context,
      options: optionsDto
    });

    return this.sendCommand('subscribeDimension', subscribeReportCommand, true, dataSink);
  };

  updateSubscription = function (commandId, options, eventHandlers) {
    const optionsDto = OptionsMapper.toDto(options);
    const updateSubscriptionCommand = ProtoLoader.Dto.UpdateSubscriptionCommandDto.create({
      commandId,
      options: optionsDto
    });
    return this.sendCommand('updateSubscription', updateSubscriptionCommand, false, eventHandlers);
  };

  editTable = function (tableName, dataSink, rowEvents, eventHandlers) {
    Logger.info(`EDIT TABLE sending row events: ${JSON.stringify(rowEvents)} on ${tableName}`);
    const rowEventDtos = [];
    rowEvents.map((rowEvent) => {
      rowEventDtos.push(RowEventMapper.toDto(rowEvent, dataSink));
    });
    const tableEvent = ProtoLoader.Dto.TableEventDto.create({
      rowEvents: rowEventDtos
    });

    const tableEditCommand = ProtoLoader.Dto.TableEditCommandDto.create({tableName, tableEvent, operation: 2 /* EDIT */});
    return this.sendCommand('tableEdit', tableEditCommand, false, eventHandlers);
  };

  invokeJSONCommand = function (controllerName, action, payload) {
    const commandExecutedPromise = new GenericJSONCommandPromise();
    Logger.debug(`JSONCommand Controller: ${controllerName} Action: ${action} Payload ${JSON.stringify(payload)}`);

    if (!controllerName){
      throw new Error('Controller name is required');
    }
    if (!action){
      throw new Error('Action name is required');
    }

    const jsonCommand = ProtoLoader.Dto.GenericJSONCommandDto.create({
      payload: JSON.stringify(payload),
      action,
      path: controllerName,
    });
    const result = {};
    const _this = this;
    const innerPromise = new Promise((resolve, reject) => {
      const resultObservable = Rx.Observable.fromPromise(commandExecutedPromise.promise);
      resultSubscription = resultObservable.subscribe(
        ev => {
          Logger.fine(`Resolved!!! JSONCommand Controller: ${controllerName} Action: ${action} Payload ${JSON.stringify(ev)}`);
          resolve(ev);
        },
        err => reject(err)
      );
      result.cancel = () => {
        Logger.fine(`Cancelling!!! JSONCommand Controller: ${controllerName} Action: ${action} Payload ${JSON.stringify(payload)}`);
        resultSubscription.unsubscribe();
      };
      _this.sendCommand('genericJSON', jsonCommand, false, commandExecutedPromise);
    });
    const {then} = innerPromise;
    result.then = then.bind(innerPromise);
    result.timeoutWithError = innerPromise.timeoutWithError;
    return result;
  };

  sendCommand = function (commandName, commandDto, continuous, eventHandlers) {
    Logger.debug(`sendCommand: ${commandName} Payload ${JSON.stringify(commandDto)}`);
    const command = new Command(commandName, commandDto);
    command.handler = eventHandlers;
    command.continuous = continuous;
    return this.network.sendCommand(command);
  };
}

