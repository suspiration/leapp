import {Component, EventEmitter, Input, OnInit, Output, TemplateRef, ViewChild} from '@angular/core';
import {Session} from '../../models/session';
import {SessionService} from '../../services/session.service';
import {CredentialsService} from '../../services/credentials.service';
import {MenuService} from '../../services/menu.service';
import {AppService, LoggerLevel, ToastLevel} from '../../services-system/app.service';
import {Router} from '@angular/router';
import {TrusterAccountService} from '../../services/truster-account.service';
import {FederatedAccountService} from '../../services/federated-account.service';
import {AzureAccountService} from '../../services/azure-account.service';
import {ConfigurationService} from '../../services-system/configuration.service';
import {AwsAccount} from '../../models/aws-account';
import {BsModalRef, BsModalService} from 'ngx-bootstrap';
import {SsmService} from '../../services/ssm.service';
import {AzureAccount} from '../../models/azure-account';
import {AwsPlainAccount} from '../../models/aws-plain-account';
import {AccountType} from '../../models/AccountType';
import {WorkspaceService} from '../../services/workspace.service';
import {environment} from '../../../environments/environment';
import {KeychainService} from '../../services-system/keychain.service';
import {AntiMemLeak} from '../../core/anti-mem-leak';
import {AwsSsoAccount} from '../../models/aws-sso-account';
import * as uuid from 'uuid';

@Component({
  selector: 'app-session-card',
  templateUrl: './session-card.component.html',
  styleUrls: ['./session-card.component.scss'],
})

export class SessionCardComponent extends AntiMemLeak implements OnInit {

  eAccountType = AccountType;

  @ViewChild('ssmModalTemplate', { static: false })
  ssmModalTemplate: TemplateRef<any>;
  @ViewChild('defaultRegionModalTemplate', { static: false })
  defaultRegionModalTemplate: TemplateRef<any>;
  @ViewChild('defaultProfileModalTemplate', { static: false })
  defaultProfileModalTemplate: TemplateRef<any>;

  modalRef: BsModalRef;

  @Input() session: Session;
  @Output() sessionsChanged = new EventEmitter();

  // Ssm instances
  ssmloading = true;
  selectedSsmRegion;
  selectedDefaultRegion;
  openSsm = false;
  awsRegions = [];
  regionOrLocations = [];
  instances = [];
  duplicateInstances = [];
  sessionDetailToShow;
  placeholder;
  profiles: any;
  selectedProfile: any;
  workspace: any;

  constructor(private sessionService: SessionService,
              private credentialsService: CredentialsService,
              private workspaceService: WorkspaceService,
              private keychainService: KeychainService,
              private menuService: MenuService,
              private appService: AppService,
              private router: Router,
              private trusterAccountService: TrusterAccountService,
              private federatedAccountService: FederatedAccountService,
              private azureAccountService: AzureAccountService,
              private configurationService: ConfigurationService,
              private ssmService: SsmService,
              private modalService: BsModalService) { super(); }

  ngOnInit() {
    // Set regions for ssm and for default region, same with locations,
    // add the correct placeholder to the select
    this.awsRegions = this.appService.getRegions();
    this.profiles = [];
    this.workspace = this.configurationService.getDefaultWorkspaceSync();
    if (this.workspace && this.workspace.profiles && this.workspace.profiles.length > 0) {
      this.profiles = this.workspace.profiles;
    }

    const azureLocations = this.appService.getLocations();
    this.regionOrLocations = this.session.account.type !== AccountType.AZURE ? this.awsRegions : azureLocations;
    this.placeholder = this.session.account.type !== AccountType.AZURE ? 'Select a default region' : 'Select a default location';
    this.selectedDefaultRegion = this.session.account.region;
    this.selectedProfile = this.session.profile;

    switch (this.session.account.type) {
      case(AccountType.AWS):
        this.sessionDetailToShow = (this.session.account as AwsAccount).role.name;
        break;
      case(AccountType.AZURE):
        this.sessionDetailToShow = (this.session.account as AzureAccount).subscriptionId;
        break;
      case(AccountType.AWS_PLAIN_USER):
        this.sessionDetailToShow = (this.session.account as AwsPlainAccount).user;
        break;
      case(AccountType.AWS_SSO):
        this.sessionDetailToShow = (this.session.account as AwsSsoAccount).role.name;
        break;
    }
  }

  /**
   * Start the selected session
   */
  startSession() {
    // Start a new session with the selected one
    this.sessionService.startSession(this.session);

    // automatically check if there is an active session and get session list again
    this.appService.redrawList.emit(true);
    this.credentialsService.refreshCredentials();
    this.appService.logger(`Starting Session`, LoggerLevel.INFO, this, JSON.stringify({ timestamp: new Date().toISOString(), id: this.session.id, account: this.session.account.accountName, type: this.session.account.type }, null, 3));
  }

  /**
   * Stop session
   */
  stopSession() {
    // Eventually close the tray
    this.sessionService.stopSession(this.session);

    // New: we need to apply changes directly on credentials file if not azure type
    this.sessionService.removeFromIniFile(this.session.profile);

    // automatically check if there is an active session or stop it
    this.credentialsService.refreshStrategySubcribeAll = false;
    this.credentialsService.refreshCredentialsEmit.emit(this.session.account.type);
    this.sessionsChanged.emit('');
    this.appService.redrawList.emit(true);
    this.appService.logger('Session Stopped', LoggerLevel.INFO, this, JSON.stringify({ timespan: new Date().toISOString(), id: this.session.id, account: this.session.account.accountName, type: this.session.account.type }, null, 3));
  }

  removeAccount(session, event) {
    event.stopPropagation();
    this.appService.confirmDialog('do you really want to delete this account?', () => {
      this.federatedAccountService.cleanKeychainIfNecessary(session);
      this.sessionService.removeSession(session);
      this.sessionsChanged.emit('');
      this.appService.logger('Session Removed', LoggerLevel.INFO, this, JSON.stringify({ timespan: new Date().toISOString(), id: session.id, account: session.account.accountName, type: session.account.type }, null, 3));
      this.appService.redrawList.emit(true);
    });
  }

  editAccount(session, event) {
    event.stopPropagation();
    this.router.navigate(['/managing', 'edit-account'], {queryParams: { sessionId: session.id }});
  }

  /**
   * Copy credentials in the clipboard
   */
  copyCredentials(session: Session, type: number, event) {
    this.openDropDown(event);
    try {
      const workspace = this.configurationService.getDefaultWorkspaceSync();
      if (workspace) {
        const sessionAccount = (session.account as AwsAccount);
        const texts = {
          1: sessionAccount.accountNumber,
          2: sessionAccount.role ? `arn:aws:iam::${(session.account as AwsAccount).accountNumber}:role/${(session.account as AwsAccount).role.name}` : ''
        };

        const text = texts[type];

        this.appService.copyToClipboard(text);
        this.appService.toast('Your information have been successfully copied!', ToastLevel.SUCCESS, 'Information copied!');
      }
    } catch (err) {
      this.appService.toast(err, ToastLevel.WARN);
      this.appService.logger(err, LoggerLevel.ERROR, this, err.stack);
    }
  }

  switchCredentials() {
    if (this.session.active) {
      this.stopSession();
    } else {
      this.startSession();
    }
  }

  openDropDown(event) {
    event.stopPropagation();
  }

  // ============================== //
  // ========== SSM AREA ========== //
  // ============================== //
  addNewProfile(tag: string) {
    return {id: uuid.v4(), name: tag};
  }

  /**
   * SSM Modal open given the correct session
   * @param session - the session to check for possible ssm sessions
   */
  ssmModalOpen(session, event) {
    // Reset things before opening the modal
    this.instances = [];
    this.ssmloading = false;
    this.modalRef = this.modalService.show(this.ssmModalTemplate, { class: 'ssm-modal'});
  }

  /**
   * SSM Modal open given the correct session
   * @param session - the session to check for possible ssm sessions
   */
  changeRegionModalOpen(session, event) {
    // open the modal
    this.modalRef = this.modalService.show(this.defaultRegionModalTemplate, { class: 'ssm-modal'});
  }

  /**
   * Set the region for ssm init and launch the mopethod form the server to find instances
   * @param event - the change select event
   */
  changeSsmRegion(event, session: Session) {
    if (this.selectedSsmRegion) {
      this.ssmloading = true;

      const account = `Leapp-ssm-data-${session.profile}`;

      // Set the aws credentials to instanziate the ssm client
      this.keychainService.getSecret(environment.appName, account).then(creds => {
        const credentials = JSON.parse(creds);

        // Check the result of the call
        this.subs.add(this.ssmService.setInfo(credentials, this.selectedSsmRegion).subscribe(result => {
          this.instances = result.instances;
          this.duplicateInstances = this.instances;
          this.ssmloading = false;
          this.appService.redrawList.emit(true);
        }, err => {
          this.instances = [];
          this.ssmloading = false;
          this.appService.redrawList.emit(true);
        }));
      });

    }
  }

  /**
   * Set the region for the session
   */
  changeDefaultRegion() {
    if (this.selectedDefaultRegion) {
      this.workspace = this.configurationService.getDefaultWorkspaceSync();

      this.workspace.sessions.forEach(session => {
        if (session.id === this.session.id) {
          session.account.region = this.selectedDefaultRegion;
          this.session.account.region = this.selectedDefaultRegion;
          this.configurationService.updateWorkspaceSync(this.workspace);

          this.sessionService.invalidateSessionToken(session);

          if (this.session.active) {
            this.startSession();
          } else {
            this.appService.redrawList.emit(true);
          }
        }
      });

      this.appService.toast('Default region has been changed!', ToastLevel.SUCCESS, 'Region changed!');
      this.modalRef.hide();
    }
  }

  /**
   * Start a new ssm session
   * @param instanceId - instance id to start ssm session
   */
  startSsmSession(instanceId) {
    this.instances.forEach(instance => { if (instance.InstanceId === instanceId) { instance.loading = true; } });

    this.ssmService.startSession(instanceId, this.selectedSsmRegion);

    setTimeout(() => {
      this.instances.forEach(instance => { if (instance.InstanceId === instanceId) { instance.loading = false; } });
    }, 4000);

    this.openSsm = false;
    this.ssmloading = false;
  }

  searchSSMInstance(event) {
    if (event.target.value !== '') {
      this.instances = this.duplicateInstances.filter(i =>
                                 i.InstanceId.indexOf(event.target.value) > -1 ||
                                 i.IPAddress.indexOf(event.target.value) > -1 ||
                                 i.Name.indexOf(event.target.value) > -1);
    } else {
      this.instances = this.duplicateInstances;
    }
  }

  getProfileIcon(active, id) {
    const profile = this.workspace.profiles.filter(p => p.id === id)[0];
    if (profile) {
      const color = active ? ' orange' : '';
      return profile.name === 'default' ? ('home' + color) : ('user' + color);
    } else {
      return 'home';
    }
  }

  getProfileName(id) {
    const workspace = this.configurationService.getDefaultWorkspaceSync();
    const profile = workspace.profiles.filter(p => p.id === id)[0];
    if (profile) {
      return profile.name;
    } else {
      return 'default';
    }
  }

  changeDefaultProfile() {
    if (this.selectedProfile) {
      if (this.session.active) {
        this.sessionService.removeFromIniFile(this.session.profile);
      }

      this.sessionService.addProfile(this.selectedProfile);
      this.sessionService.updateSessionProfile(this.session, this.selectedProfile);

      if (this.session.active) {
        this.startSession();
      } else {
        this.appService.redrawList.emit(true);
      }

      this.appService.toast('Profile has been changed!', ToastLevel.SUCCESS, 'Profile changed!');
      this.modalRef.hide();
    }
  }

  changeProfileModalOpen(session: Session, $event: MouseEvent) {
    this.selectedProfile = null;
    this.modalRef = this.modalService.show(this.defaultProfileModalTemplate, { class: 'ssm-modal'});
  }

  goBack() {
    this.modalRef.hide();
  }
}
